import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

vi.mock('../lib/clients', () => ({
  ddb: { send: vi.fn() },
  sqs: { send: vi.fn() },
}));

import { ddb, sqs } from '../lib/clients';
import { handler } from './createNotification';

const ddbSend = ddb.send as unknown as Mock;
const sqsSend = sqs.send as unknown as Mock;

const valid = { recipient: 'bold@example.com', channel: 'EMAIL', message: 'Hello' };

const call = async (body: unknown) => {
  const event = {
    body: typeof body === 'string' ? body : JSON.stringify(body),
  } as APIGatewayProxyEventV2;
  const res = (await handler(event, {} as never, () => undefined)) as {
    statusCode: number;
    body: string;
  };
  return { status: res.statusCode, body: JSON.parse(res.body) };
};

beforeEach(() => {
  vi.resetAllMocks();
  process.env.NOTIFICATIONS_TABLE = 'notifications-table';
  process.env.QUEUE_URL = 'https://sqs.example/queue';
});

describe('createNotification', () => {
  it('rejects a body that is not valid JSON', async () => {
    const res = await call('{not json');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid JSON' });
    expect(ddbSend).not.toHaveBeenCalled();
    expect(sqsSend).not.toHaveBeenCalled();
  });

  it('rejects an invalid request without touching DynamoDB or SQS', async () => {
    const res = await call({ ...valid, recipient: '  ' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'recipient is required' });
    expect(ddbSend).not.toHaveBeenCalled();
    expect(sqsSend).not.toHaveBeenCalled();
  });

  it('stores a PENDING item, enqueues only its id and returns 201', async () => {
    const res = await call({ recipient: '  bold@example.com ', channel: 'SMS', message: ' Hi ' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      recipient: 'bold@example.com',
      channel: 'SMS',
      message: 'Hi',
      status: 'PENDING',
    });

    const put = ddbSend.mock.calls[0][0].input;
    expect(put.TableName).toBe('notifications-table');
    expect(put.Item).toEqual(res.body);

    const message = sqsSend.mock.calls[0][0].input;
    expect(message.QueueUrl).toBe('https://sqs.example/queue');
    expect(JSON.parse(message.MessageBody)).toEqual({ id: res.body.id });
  });

  it('writes to DynamoDB before it enqueues', async () => {
    const order: string[] = [];
    ddbSend.mockImplementation(async () => order.push('dynamodb'));
    sqsSend.mockImplementation(async () => order.push('sqs'));

    await call(valid);

    expect(order).toEqual(['dynamodb', 'sqs']);
  });

  it('marks the item FAILED and returns 500 when enqueueing fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    sqsSend.mockRejectedValueOnce(new Error('SQS down'));

    const res = await call(valid);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to queue notification' });
    expect(ddbSend).toHaveBeenCalledTimes(2);
    expect(ddbSend.mock.calls[1][0].input.ExpressionAttributeValues).toMatchObject({
      ':s': 'FAILED',
      ':r': 'Could not enqueue notification',
    });
  });
});
