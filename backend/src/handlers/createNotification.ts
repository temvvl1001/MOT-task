import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { randomUUID } from 'crypto';
import { PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { ddb, sqs } from '../lib/clients';
import { json } from '../lib/http';
import { Notification } from '../lib/types';
import { validateCreateInput } from '../lib/validate';

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  let body: any;
  try {
    body = JSON.parse(event.body ?? '');
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  const error = validateCreateInput(body);
  if (error) return json(400, { error });

  const now = new Date().toISOString();
  const notification: Notification = {
    id: randomUUID(),
    recipient: body.recipient.trim(),
    channel: body.channel,
    message: body.message.trim(),
    status: 'PENDING',
    createdAt: now,
    updatedAt: now,
  };

  await ddb.send(
    new PutCommand({
      TableName: process.env.NOTIFICATIONS_TABLE,
      Item: notification,
    })
  );

  try {
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: process.env.QUEUE_URL,
        MessageBody: JSON.stringify({ id: notification.id }),
      })
    );
  } catch (err) {
    console.error('Failed to enqueue', err);
    await ddb.send(
      new UpdateCommand({
        TableName: process.env.NOTIFICATIONS_TABLE,
        Key: { id: notification.id },
        UpdateExpression: 'SET #s = :s, #r = :r, updatedAt = :u',
        ExpressionAttributeNames: { '#s': 'status', '#r': 'result' },
        ExpressionAttributeValues: {
          ':s': 'FAILED',
          ':r': 'Could not enqueue notification',
          ':u': new Date().toISOString(),
        },
      })
    );
    return json(500, { error: 'Failed to queue notification' });
  }

  return json(201, notification);
};