import { UpdateCommand, UpdateCommandInput } from '@aws-sdk/lib-dynamodb';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { ddb } from './clients';
import { LEASE_MS } from './config';
import { Notification } from './types';

// Status өөрчлөлт бүр нэг нөхцөлт UpdateItem тул хоёр worker (давхар SQS хүргэлт, унасны дараах дахин хүргэлт)
// нэг мөрийн төлөө өрсөлдвөл DynamoDB өөрөө ялагчийг шийднэ.

// Нөхцөл биелэхгүй бол null буцаана: мөрийг өөр хүн эзэмшсэн эсвэл аль хэдийн дууссан.
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

// PENDING -> PROCESSING. Хуучирсан PROCESSING мөрийг ч авна (өмнөх worker
// унасан). Байхгүй, дууссан, боловсруулагдаж буй мөрөнд бүтэлгүйтнэ.
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

// Түр зуурын алдааны дараа PROCESSING -> PENDING, ингэснээр дахин хүргэсэн message дахин claim хийнэ.
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

// PENDING | PROCESSING -> FAILED. Message dead-letter болсон үед хэрэглэнэ.
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
