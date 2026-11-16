import { APIGatewayProxyHandlerV2WithJWTAuthorizer } from 'aws-lambda';
import { createHash, randomUUID } from 'crypto';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { userIdOf } from '../lib/auth';
import { ddb, sqs } from '../lib/clients';
import { RETENTION_SECONDS } from '../lib/config';
import { apiError, json } from '../lib/http';
import { Notification } from '../lib/types';
import { validateCreateInput } from '../lib/validate';

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,64}$/;

// The same user and the same key always map to the same id, so a client that retries a request
// (timeout, double click, lost response) can never create a second notification.
const idFor = (userId: string, key: string) => {
  const h = createHash('sha256').update(`${userId}:${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
  const userId = userIdOf(event);
  if (!userId) return apiError(401, 'unauthorized', 'Unauthorized');

  const key = event.headers?.['idempotency-key'];
  if (key !== undefined && !IDEMPOTENCY_KEY.test(key)) {
    return apiError(
      400,
      'invalid_idempotency_key',
      'Idempotency-Key must be 8-64 characters: letters, digits, - or _'
    );
  }

  let body: any;
  try {
    body = JSON.parse(event.body ?? '');
  } catch {
    return apiError(400, 'invalid_json', 'Invalid JSON');
  }

  const error = validateCreateInput(body);
  if (error) return json(400, error);

  const now = new Date().toISOString();
  const notification: Notification = {
    id: key ? idFor(userId, key) : randomUUID(),
    userId,
    recipient: body.recipient.trim(),
    channel: body.channel,
    message: body.message.trim(),
    status: 'PENDING',
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    expiresAt: Math.floor(Date.now() / 1000) + RETENTION_SECONDS,
  };

  // Step 1, the commit point: once the item is in DynamoDB the request is durable.
  try {
    await ddb.send(
      new PutCommand({
        TableName: process.env.NOTIFICATIONS_TABLE,
        Item: notification,
        ConditionExpression: 'attribute_not_exists(id)',
      })
    );
  } catch (err) {
    if (!(err instanceof ConditionalCheckFailedException)) throw err;
    // Same Idempotency-Key as an earlier request: return that notification, do not queue it again.
    const { Item } = await ddb.send(
      new GetCommand({ TableName: process.env.NOTIFICATIONS_TABLE, Key: { id: notification.id } })
    );
    // A key must stand for one request. The same key with different content is a client bug and
    // must not silently answer with some other request's notification.
    if (
      !Item ||
      Item.recipient !== notification.recipient ||
      Item.channel !== notification.channel ||
      Item.message !== notification.message
    ) {
      return apiError(
        409,
        'idempotency_key_reused',
        'This Idempotency-Key was already used with a different request'
      );
    }
    return json(200, Item);
  }

  // Step 2: queue it. This can fail on its own (SQS outage, Lambda killed in between). The
  // item stays PENDING and the scheduled requeueStale function enqueues it later, so the
  // request is never lost. 202 tells the client it is accepted but not queued yet.
  try {
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: process.env.QUEUE_URL,
        MessageBody: JSON.stringify({ id: notification.id }),
      })
    );
  } catch (err) {
    console.error(`Could not enqueue ${notification.id}; requeueStale will retry`, err);
    return json(202, notification);
  }

  return json(201, notification);
};
