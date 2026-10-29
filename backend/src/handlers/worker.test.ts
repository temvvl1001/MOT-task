import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import type { SQSEvent } from 'aws-lambda';
import type { Notification } from '../lib/types';

vi.mock('../lib/clients', () => ({ ddb: { send: vi.fn() } }));
vi.mock('../lib/broadcast', () => ({ broadcastNotification: vi.fn() }));
vi.mock('../lib/deliver', () => ({ deliver: vi.fn() }));

import { ddb } from '../lib/clients';
import { broadcastNotification } from '../lib/broadcast';
import { deliver } from '../lib/deliver';
import { handler } from './worker';

const send = ddb.send as unknown as Mock;
const broadcast = broadcastNotification as unknown as Mock;
const deliverMock = deliver as unknown as Mock;

const item = (status: Notification['status'], result?: string): Notification => ({
  id: 'n1',
  recipient: 'bold@example.com',
  channel: 'EMAIL',
  message: 'Hello',
  status,
  result,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const conflict = () =>
  new ConditionalCheckFailedException({ message: 'conflict', $metadata: {} });

const run = (...ids: string[]) => {
  const event = {
    Records: ids.map((id) => ({ body: JSON.stringify({ id }) })),
  } as SQSEvent;
  return handler(event, {} as never, () => undefined);
};

// The UpdateCommand input of the nth ddb.send call.
const inputOf = (call: number) => send.mock.calls[call][0].input;

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

describe('worker', () => {
  it('moves PENDING -> PROCESSING -> COMPLETED and broadcasts both changes', async () => {
    send
      .mockResolvedValueOnce({ Attributes: item('PROCESSING') })
      .mockResolvedValueOnce({ Attributes: item('COMPLETED', 'Delivered') });
    deliverMock.mockResolvedValue('Delivered');

    await run('n1');

    expect(deliverMock).toHaveBeenCalledTimes(1);
    expect(broadcast.mock.calls.map(([n]) => n.status)).toEqual(['PROCESSING', 'COMPLETED']);
    expect(inputOf(1).ExpressionAttributeValues).toMatchObject({
      ':s': 'COMPLETED',
      ':r': 'Delivered',
    });
  });

  it('records FAILED with the error message when delivery is rejected', async () => {
    send
      .mockResolvedValueOnce({ Attributes: item('PROCESSING') })
      .mockResolvedValueOnce({ Attributes: item('FAILED', 'rejected') });
    deliverMock.mockRejectedValue(new Error('rejected'));

    await run('n1');

    expect(inputOf(1).ExpressionAttributeValues).toMatchObject({
      ':s': 'FAILED',
      ':r': 'rejected',
    });
    expect(broadcast.mock.calls.map(([n]) => n.status)).toEqual(['PROCESSING', 'FAILED']);
  });

  it('claims atomically: only from PENDING, or from a stale PROCESSING lease', async () => {
    send.mockRejectedValueOnce(conflict());

    await run('n1');

    const claim = inputOf(0);
    expect(claim.ConditionExpression).toContain('#s = :pending');
    expect(claim.ConditionExpression).toContain('updatedAt < :staleBefore');
    expect(claim.ExpressionAttributeValues[':pending']).toBe('PENDING');
  });

  it('skips a notification that is missing, finished or being processed elsewhere', async () => {
    send.mockRejectedValueOnce(conflict());

    await run('n1');

    expect(send).toHaveBeenCalledTimes(1);
    expect(deliverMock).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('does not broadcast a result when another worker already finished the item', async () => {
    send.mockResolvedValueOnce({ Attributes: item('PROCESSING') }).mockRejectedValueOnce(conflict());
    deliverMock.mockResolvedValue('Delivered');

    await run('n1');

    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast.mock.calls[0][0].status).toBe('PROCESSING');
  });

  it('rethrows unexpected errors so SQS retries the message', async () => {
    send.mockRejectedValueOnce(new Error('DynamoDB unavailable'));

    await expect(run('n1')).rejects.toThrow('DynamoDB unavailable');
    expect(deliverMock).not.toHaveBeenCalled();
  });

  it('processes every record in a batch', async () => {
    send
      .mockResolvedValueOnce({ Attributes: item('PROCESSING') })
      .mockResolvedValueOnce({ Attributes: item('COMPLETED') })
      .mockResolvedValueOnce({ Attributes: item('PROCESSING') })
      .mockResolvedValueOnce({ Attributes: item('COMPLETED') });
    deliverMock.mockResolvedValue('Delivered');

    await run('n1', 'n2');

    expect(deliverMock).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(4);
  });
});