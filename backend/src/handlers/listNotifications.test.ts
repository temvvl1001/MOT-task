import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { callApi } from '../test/events';
import { decodeCursor, encodeCursor } from '../lib/pagination';

vi.mock('../lib/clients', () => ({ ddb: { send: vi.fn() } }));

import { ddb } from '../lib/clients';
import { handler } from './listNotifications';

const send = ddb.send as unknown as Mock;
const list = (options: Parameters<typeof callApi>[1] = {}) =>
  callApi(handler, { userId: 'user-1', ...options });
const queryInput = () => send.mock.calls[0][0].input;

beforeEach(() => {
  vi.resetAllMocks();
  process.env.NOTIFICATIONS_TABLE = 'notifications-table';
  send.mockResolvedValue({ Items: [] });
});

describe('listNotifications', () => {
  it('баталгаажсан хэрэглэгчгүй хүсэлтийг татгалзана', async () => {
    const res = await callApi(handler, {});

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('unauthorized');
    expect(send).not.toHaveBeenCalled();
  });

  it('byUser индексээс зөвхөн дуудагчийн мөрүүдийг, шинэ нь эхэнд нь Query хийнэ', async () => {
    await list();

    expect(queryInput()).toMatchObject({
      TableName: 'notifications-table',
      IndexName: 'byUser',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: { ':userId': 'user-1' },
      ScanIndexForward: false,
      Limit: 20,
    });
  });

  it('сүүлийн хуудсанд мөрүүдийг буцааж, nextToken өгөхгүй', async () => {
    send.mockResolvedValueOnce({ Items: [{ id: 'a' }, { id: 'b' }] });

    const res = await list();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [{ id: 'a' }, { id: 'b' }] });
  });

  it('DynamoDB илүү мөр байгааг мэдэгдвэл nextToken буцаана', async () => {
    const key = { id: 'b', userId: 'user-1', createdAt: '2026-01-01T00:00:00.000Z' };
    send.mockResolvedValueOnce({ Items: [{ id: 'a' }, { id: 'b' }], LastEvaluatedKey: key });

    const res = await list({ query: { limit: '2' } });

    expect(queryInput().Limit).toBe(2);
    expect(decodeCursor(res.body.nextToken, 'user-1')).toEqual(key);
  });

  it('өмнөх хуудасны cursor-оос үргэлжлүүлнэ', async () => {
    const key = { id: 'b', userId: 'user-1', createdAt: '2026-01-01T00:00:00.000Z' };

    await list({ query: { nextToken: encodeCursor(key) } });

    expect(queryInput().ExclusiveStartKey).toEqual(key);
  });

  it('өөр хэрэглэгчийн cursor-ыг татгалзана (бусдын мөрийг унших боломжгүй)', async () => {
    const foreign = encodeCursor({ id: 'x', userId: 'user-2', createdAt: '2026-01-01T00:00:00.000Z' });

    const res = await list({ query: { nextToken: foreign } });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ code: 'invalid_next_token', error: 'Invalid nextToken' });
    expect(send).not.toHaveBeenCalled();
  });

  it('утгагүй cursor-ыг татгалзана', async () => {
    const res = await list({ query: { nextToken: 'not-a-cursor' } });

    expect(res.status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it.each(['0', '-1', '51', 'abc', '1.5'])('limit=%s-ийг татгалзана', async (limit) => {
    const res = await list({ query: { limit } });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_limit');
    expect(send).not.toHaveBeenCalled();
  });
});
