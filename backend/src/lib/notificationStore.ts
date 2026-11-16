import { UpdateCommand, UpdateCommandInput } from '@aws-sdk/lib-dynamodb';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { ddb } from './clients';
import { LEASE_MS } from './config';
import { Notification } from './types';

// Every status change is one conditional UpdateItem, so DynamoDB itself decides the winner
// when two workers (duplicate SQS delivery, crash + redelivery) race for the same item.

// Returns null when the condition fails: someone else owns the item or it already finished.
const conditionalUpdate = async (
  input: Omit<UpdateCommandInput, 'TableName' | 'ReturnValues'>
): Promise<Notification | null> => {
  try {
    const { Attributes } = await ddb.send(
      new UpdateCommand({
        TableName: process.env.NOTIFICATIONS_TABLE,
        ReturnValues: 'ALL_NEW',
        ...input,
      })
    );
    return Attributes as Notification;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return null;
    throw err;
  }
};

// PENDING -> PROCESSING. Also succeeds for a stale PROCESSING item (the previous worker
// died). Fails for missing, finished or in-flight items.
export const claim = (id: string, attempt: number) => {
  const now = Date.now();
  return conditionalUpdate({
    Key: { id },
    UpdateExpression: 'SET #s = :processing, attempts = :attempt, updatedAt = :now',
    ConditionExpression: '#s = :pending OR (#s = :processing AND updatedAt < :staleBefore)',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: {
      ':pending': 'PENDING',
      ':processing': 'PROCESSING',
      ':attempt': attempt,
      ':now': new Date(now).toISOString(),
      ':staleBefore': new Date(now - LEASE_MS).toISOString(),
    },
  });
};

// PROCESSING -> COMPLETED | FAILED.
export const finish = (id: string, status: 'COMPLETED' | 'FAILED', result: string) =>
  conditionalUpdate({
    Key: { id },
    UpdateExpression: 'SET #s = :s, #r = :r, updatedAt = :now',
    ConditionExpression: '#s = :processing',
    ExpressionAttributeNames: { '#s': 'status', '#r': 'result' },
    ExpressionAttributeValues: {
      ':s': status,
      ':r': result,
      ':processing': 'PROCESSING',
      ':now': new Date().toISOString(),
    },
  });

// PROCESSING -> PENDING after a temporary failure, so the redelivered message can claim it again.
export const release = (id: string, reason: string) =>
  conditionalUpdate({
    Key: { id },
    UpdateExpression: 'SET #s = :pending, #r = :r, updatedAt = :now',
    ConditionExpression: '#s = :processing',
    ExpressionAttributeNames: { '#s': 'status', '#r': 'result' },
    ExpressionAttributeValues: {
      ':pending': 'PENDING',
      ':processing': 'PROCESSING',
      ':r': reason,
      ':now': new Date().toISOString(),
    },
  });

// PENDING | PROCESSING -> FAILED. Used when the message was dead-lettered.
export const failUnfinished = (id: string, reason: string) =>
  conditionalUpdate({
    Key: { id },
    UpdateExpression: 'SET #s = :failed, #r = :r, updatedAt = :now',
    ConditionExpression: '#s = :pending OR #s = :processing',
    ExpressionAttributeNames: { '#s': 'status', '#r': 'result' },
    ExpressionAttributeValues: {
      ':failed': 'FAILED',
      ':pending': 'PENDING',
      ':processing': 'PROCESSING',
      ':r': reason,
      ':now': new Date().toISOString(),
    },
  });
