import { SQSHandler } from 'aws-lambda';
import { UpdateCommand, UpdateCommandInput } from '@aws-sdk/lib-dynamodb';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { ddb } from '../lib/clients';
import { broadcastNotification } from '../lib/broadcast';
import { deliver } from '../lib/deliver';
import { Notification } from '../lib/types';

const TableName = process.env.NOTIFICATIONS_TABLE;

// The worker Lambda times out after 30s. A PROCESSING item that has not been
// touched for longer than this is treated as abandoned and may be claimed again.
export const LEASE_MS = 60_000;

// Runs an UpdateItem whose condition is allowed to fail.
// Returns null when the condition fails: another worker owns the item.
const conditionalUpdate = async (
  input: Omit<UpdateCommandInput, 'TableName' | 'ReturnValues'>
): Promise<Notification | null> => {
  try {
    const { Attributes } = await ddb.send(
      new UpdateCommand({ TableName, ReturnValues: 'ALL_NEW', ...input })
    );
    return Attributes as Notification;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return null;
    throw err;
  }
};

// PENDING -> PROCESSING, atomically. Also succeeds for a stale PROCESSING item
// (the previous worker crashed). Fails for missing, finished or in-flight items.
const claim = (id: string) => {
  const now = Date.now();
  return conditionalUpdate({
    Key: { id },
    UpdateExpression: 'SET #s = :processing, updatedAt = :now',
    ConditionExpression: '#s = :pending OR (#s = :processing AND updatedAt < :staleBefore)',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: {
      ':pending': 'PENDING',
      ':processing': 'PROCESSING',
      ':now': new Date(now).toISOString(),
      ':staleBefore': new Date(now - LEASE_MS).toISOString(),
    },
  });
};

// PROCESSING -> COMPLETED | FAILED, atomically.
const finish = (id: string, status: 'COMPLETED' | 'FAILED', result: string) =>
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

export const handler: SQSHandler = async (event) => {
  for (const record of event.Records) {
    const { id } = JSON.parse(record.body) as { id: string };

    const claimed = await claim(id);
    if (!claimed) {
      console.log(`Notification ${id} is missing, finished or in progress, skipping`);
      continue;
    }
    await broadcastNotification(claimed);

    let status: 'COMPLETED' | 'FAILED';
    let result: string;
    try {
      result = await deliver(claimed);
      status = 'COMPLETED';
    } catch (err) {
      result = err instanceof Error ? err.message : 'Unknown error';
      status = 'FAILED';
    }

    const finished = await finish(id, status, result);
    if (finished) await broadcastNotification(finished);
  }
};