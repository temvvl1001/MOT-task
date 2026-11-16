import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('../lib/clients', () => ({ ddb: { send: vi.fn() }, sqs: { send: vi.fn() } }));

import { ddb, sqs } from '../lib/clients';
import { handler } from './requeueStale';

const ddbSend = ddb.send as unknown as Mock;
const sqsSend = sqs.send as unknown as Mock;

const items = (count: number, from = 0) =>
  Array.from({ length: count }, (_, i) => ({ id: `n${from + i}` }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T12:00:00.000Z'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  process.env.NOTIFICATIONS_TABLE = 'notifications-table';
  process.env.QUEUE_URL = 'https://sqs.example/queue';
  sqsSend.mockResolvedValue({});
});

afterEach(() => {
  vi.useRealTimers();
});

describe('requeueStale', () => {
  it('хэн ч хөндөөгүй удсан PENDING мөрүүдийг л хайна', async () => {
    ddbSend.mockResolvedValueOnce({ Items: [] });

    await handler();

    expect(ddbSend.mock.calls[0][0].input).toMatchObject({
      IndexName: 'byStatus',
      KeyConditionExpression: '#s = :pending AND updatedAt < :cutoff',
      ExpressionAttributeValues: { ':pending': 'PENDING', ':cutoff': '2026-01-01T11:58:00.000Z' },
    });
  });

  it('удсан мөр байхгүй бол юу ч хийхгүй', async () => {
    ddbSend.mockResolvedValueOnce({ Items: [] });

    await expect(handler()).resolves.toEqual({ requeued: 0 });
    expect(sqsSend).not.toHaveBeenCalled();
  });

  it('удсан id-уудыг SQS-д арав арваар нь дахин оруулна', async () => {
    ddbSend.mockResolvedValueOnce({ Items: items(25) });

    const res = await handler();

    expect(res).toEqual({ requeued: 25 });
    expect(sqsSend).toHaveBeenCalledTimes(3);
    const entries = sqsSend.mock.calls[0][0].input.Entries;
    expect(entries).toHaveLength(10);
    expect(JSON.parse(entries[0].MessageBody)).toEqual({ id: 'n0' });
  });

  it('индексийн дараагийн хуудсуудыг мөн уншина', async () => {
    ddbSend
      .mockResolvedValueOnce({ Items: items(100), LastEvaluatedKey: { id: 'n99' } })
      .mockResolvedValueOnce({ Items: items(5, 100) });

    const res = await handler();

    expect(res).toEqual({ requeued: 105 });
    expect(ddbSend.mock.calls[1][0].input.ExclusiveStartKey).toEqual({ id: 'n99' });
  });

  it('SQS-ийн татгалзсан мөрүүдийг алдаа шидэлгүй лог хийнэ', async () => {
    ddbSend.mockResolvedValueOnce({ Items: items(2) });
    sqsSend.mockResolvedValueOnce({ Failed: [{ Id: '0', Code: 'Throttled' }] });

    await expect(handler()).resolves.toEqual({ requeued: 2 });
    expect(console.error).toHaveBeenCalled();
  });
});
