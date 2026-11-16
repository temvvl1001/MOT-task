import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { callApi } from '../test/events';

vi.mock('../lib/clients', () => ({
  ddb: { send: vi.fn() },
  sqs: { send: vi.fn() },
}));

import { ddb, sqs } from '../lib/clients';
import { handler } from './createNotification';

const ddbSend = ddb.send as unknown as Mock;
const sqsSend = sqs.send as unknown as Mock;

const valid = { recipient: 'bold@example.com', channel: 'EMAIL', message: 'Hello' };
const conflict = () =>
  new ConditionalCheckFailedException({ message: 'exists', $metadata: {} });

const create = (options: Parameters<typeof callApi>[1] = {}) =>
  callApi(handler, { userId: 'user-1', body: valid, ...options });

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  process.env.NOTIFICATIONS_TABLE = 'notifications-table';
  process.env.QUEUE_URL = 'https://sqs.example/queue';
});

describe('createNotification: оролт', () => {
  it('баталгаажсан хэрэглэгчгүй хүсэлтийг татгалзана', async () => {
    const res = await callApi(handler, { body: valid });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ code: 'unauthorized', error: 'Unauthorized' });
    expect(ddbSend).not.toHaveBeenCalled();
    expect(sqsSend).not.toHaveBeenCalled();
  });

  it('JSON биш body-г татгалзана', async () => {
    const res = await create({ body: '{not json' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ code: 'invalid_json', error: 'Invalid JSON' });
  });

  it('буруу хүсэлтийг DynamoDB, SQS-д хүрэхээс өмнө татгалзаж, кодтой алдаа буцаана', async () => {
    const res = await create({ body: { ...valid, recipient: '  ' } });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ code: 'recipient_required', error: 'recipient is required' });
    expect(ddbSend).not.toHaveBeenCalled();
    expect(sqsSend).not.toHaveBeenCalled();
  });

  it.each(['short', 'has spaces in it', 'x'.repeat(65)])(
    'буруу хэлбэрийн Idempotency-Key-г татгалзана (%s)',
    async (key) => {
      const res = await create({ headers: { 'idempotency-key': key } });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('invalid_idempotency_key');
      expect(ddbSend).not.toHaveBeenCalled();
    }
  );
});

describe('createNotification: амжилттай тохиолдол', () => {
  it('токений эзэмшигчтэй PENDING мөр хадгалж, зөвхөн id-г дараалалд тавиад 201 буцаана', async () => {
    const res = await create({
      body: { recipient: '  bold@example.com ', channel: 'SMS', message: ' Hi ' },
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      userId: 'user-1',
      recipient: 'bold@example.com',
      channel: 'SMS',
      message: 'Hi',
      status: 'PENDING',
      attempts: 0,
    });

    const put = ddbSend.mock.calls[0][0].input;
    expect(put.TableName).toBe('notifications-table');
    expect(put.Item).toEqual(res.body);
    expect(put.ConditionExpression).toBe('attribute_not_exists(id)');

    const message = sqsSend.mock.calls[0][0].input;
    expect(message.QueueUrl).toBe('https://sqs.example/queue');
    expect(JSON.parse(message.MessageBody)).toEqual({ id: res.body.id });
  });

  it('эзэмшигчийг зөвхөн токеноос авна, body дахь userId-г үл тооно', async () => {
    const res = await create({ body: { ...valid, userId: 'someone-else' } });

    expect(res.body.userId).toBe('user-1');
    expect(ddbSend.mock.calls[0][0].input.Item.userId).toBe('user-1');
  });

  it('эхлээд DynamoDB-д бичиж, дараа нь дараалалд тавина', async () => {
    const order: string[] = [];
    ddbSend.mockImplementation(async () => order.push('dynamodb'));
    sqsSend.mockImplementation(async () => order.push('sqs'));

    await create();

    expect(order).toEqual(['dynamodb', 'sqs']);
  });
});

describe('createNotification: хэсэгчилсэн алдаа ба давтагдсан хүсэлт', () => {
  it('SQS унавал мөрийг хадгалж 202 буцаана, sweeper дараа нь дараалалд оруулна', async () => {
    sqsSend.mockRejectedValueOnce(new Error('SQS down'));

    const res = await create();

    expect(res.status).toBe(202);
    expect(res.body.status).toBe('PENDING');
    // DynamoDB-д зөвхөн анхны Put хийгдсэн: юуг ч FAILED болгоогүй
    expect(ddbSend).toHaveBeenCalledTimes(1);
  });

  it('DynamoDB-ийн гэнэтийн алдааг дахин шидэж, дараалалд юу ч тавихгүй', async () => {
    ddbSend.mockRejectedValueOnce(new Error('DynamoDB unavailable'));

    await expect(create()).rejects.toThrow('DynamoDB unavailable');
    expect(sqsSend).not.toHaveBeenCalled();
  });

  it('id-г хэрэглэгч ба Idempotency-Key-ээс гаргадаг тул давтан хүсэлт ижил мөрийг заана', async () => {
    const headers = { 'idempotency-key': 'abcdefgh-1234' };

    const first = await create({ headers });
    const again = await create({ headers });
    const otherUser = await callApi(handler, { userId: 'user-2', body: valid, headers });

    expect(again.body.id).toBe(first.body.id);
    expect(otherUser.body.id).not.toBe(first.body.id);
  });

  it('ижил Idempotency-Key-тэй давтан хүсэлтэд анхны мөрийг буцааж, дахин дараалалд тавихгүй', async () => {
    const existing = { id: 'existing', userId: 'user-1', status: 'COMPLETED', ...valid };
    ddbSend.mockRejectedValueOnce(conflict()).mockResolvedValueOnce({ Item: existing });

    const res = await create({ headers: { 'idempotency-key': 'abcdefgh-1234' } });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(existing);
    expect(sqsSend).not.toHaveBeenCalled();
  });

  it('ижил түлхүүрийг ӨӨР агуулгатай хүсэлтэд ашиглавал 409 өгч, өөр хүсэлтийн мөрийг буцаахгүй', async () => {
    const existing = { id: 'existing', userId: 'user-1', status: 'COMPLETED', ...valid };
    ddbSend.mockRejectedValueOnce(conflict()).mockResolvedValueOnce({ Item: existing });

    const res = await create({
      body: { ...valid, message: 'Өөр мессеж' },
      headers: { 'idempotency-key': 'abcdefgh-1234' },
    });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('idempotency_key_reused');
    expect(sqsSend).not.toHaveBeenCalled();
  });

  it('түлхүүр ашиглагдсан мөр хугацаа дууссаны улмаас алга болсон бол 409 өгнө', async () => {
    ddbSend.mockRejectedValueOnce(conflict()).mockResolvedValueOnce({});

    const res = await create({ headers: { 'idempotency-key': 'abcdefgh-1234' } });

    expect(res.status).toBe(409);
  });
});

describe('createNotification: өгөгдөл хадгалах хугацаа', () => {
  it('мөр бүрт TTL-д зориулсан expiresAt (90 хоногийн дараа) тавина', async () => {
    const before = Math.floor(Date.now() / 1000);

    const res = await create();

    const ninetyDays = 90 * 24 * 60 * 60;
    expect(res.body.expiresAt).toBeGreaterThanOrEqual(before + ninetyDays);
    expect(res.body.expiresAt).toBeLessThanOrEqual(before + ninetyDays + 5);
  });
});
