import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { PermanentDeliveryError, TemporaryDeliveryError } from '../lib/errors';
import type { Notification } from '../lib/types';

vi.mock('../lib/clients', () => ({ ddb: { send: vi.fn() }, sqs: { send: vi.fn() } }));
vi.mock('../lib/broadcast', () => ({ broadcastNotification: vi.fn() }));
vi.mock('../lib/deliver', () => ({ deliver: vi.fn() }));

import { ddb, sqs } from '../lib/clients';
import { broadcastNotification } from '../lib/broadcast';
import { deliver } from '../lib/deliver';
import { handler } from './worker';

const ddbSend = ddb.send as unknown as Mock;
const sqsSend = sqs.send as unknown as Mock;
const broadcast = broadcastNotification as unknown as Mock;
const deliverMock = deliver as unknown as Mock;

const item = (status: Notification['status'], extra: Partial<Notification> = {}): Notification => ({
  id: 'n1',
  userId: 'user-1',
  recipient: 'bold@example.com',
  channel: 'EMAIL',
  message: 'Hello',
  status,
  attempts: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...extra,
});

const conflict = () =>
  new ConditionalCheckFailedException({ message: 'conflict', $metadata: {} });

const record = (id = 'n1', receiveCount = 1) => ({
  messageId: `m-${id}`,
  receiptHandle: `rh-${id}`,
  body: JSON.stringify({ id }),
  attributes: { ApproximateReceiveCount: String(receiveCount) },
});

const run = (...records: ReturnType<typeof record>[]) =>
  handler({ Records: records } as unknown as SQSEvent, {} as never, () => undefined) as Promise<SQSBatchResponse>;

const ddbInput = (call: number) => ddbSend.mock.calls[call][0].input;
const pushedStatuses = () => broadcast.mock.calls.map(([n]) => n.status);

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  process.env.NOTIFICATIONS_TABLE = 'notifications-table';
  process.env.QUEUE_URL = 'https://sqs.example/queue';
});

describe('worker: амжилттай хүргэлт', () => {
  it('PENDING -> PROCESSING -> COMPLETED болгож, өөрчлөлт бүрийг эзэмшигчид push хийнэ', async () => {
    ddbSend
      .mockResolvedValueOnce({ Attributes: item('PROCESSING') })
      .mockResolvedValueOnce({ Attributes: item('COMPLETED', { result: 'Хүргэгдлээ' }) });
    deliverMock.mockResolvedValue('Хүргэгдлээ');

    const res = await run(record());

    expect(res.batchItemFailures).toEqual([]);
    expect(pushedStatuses()).toEqual(['PROCESSING', 'COMPLETED']);
    expect(ddbInput(1).ExpressionAttributeValues).toMatchObject({
      ':s': 'COMPLETED',
      ':r': 'Хүргэгдлээ',
    });
  });

  it('SQS-ийн хүлээн авсан тоог оролдлогын дугаар болгон хүргэлтэд дамжуулна', async () => {
    ddbSend
      .mockResolvedValueOnce({ Attributes: item('PROCESSING') })
      .mockResolvedValueOnce({ Attributes: item('COMPLETED') });
    deliverMock.mockResolvedValue('ok');

    await run(record('n1', 2));

    expect(deliverMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'n1' }), 2);
    expect(ddbInput(0).ExpressionAttributeValues[':attempt']).toBe(2);
  });
});

describe('worker: байнгын алдаа', () => {
  it('шууд FAILED болгож, дахин оролдохгүй', async () => {
    ddbSend
      .mockResolvedValueOnce({ Attributes: item('PROCESSING') })
      .mockResolvedValueOnce({ Attributes: item('FAILED', { result: 'татгалзсан' }) });
    deliverMock.mockRejectedValue(new PermanentDeliveryError('татгалзсан'));

    const res = await run(record());

    expect(res.batchItemFailures).toEqual([]);
    expect(ddbSend).toHaveBeenCalledTimes(2);
    expect(ddbInput(1).ExpressionAttributeValues).toMatchObject({
      ':s': 'FAILED',
      ':r': 'татгалзсан',
    });
    expect(pushedStatuses()).toEqual(['PROCESSING', 'FAILED']);
    expect(sqsSend).not.toHaveBeenCalled();
  });
});

describe('worker: түр зуурын алдаа', () => {
  it('мөрийг PENDING рүү буцааж, SQS-д backoff-той дахин хүргүүлэхийг хүснэ', async () => {
    ddbSend
      .mockResolvedValueOnce({ Attributes: item('PROCESSING') })
      .mockResolvedValueOnce({ Attributes: item('PENDING') });
    deliverMock.mockRejectedValue(new TemporaryDeliveryError('Үйлчилгээ унасан'));

    const res = await run(record('n1', 1));

    expect(res.batchItemFailures).toEqual([{ itemIdentifier: 'm-n1' }]);
    expect(ddbInput(1).ExpressionAttributeValues[':pending']).toBe('PENDING');
    expect(ddbInput(1).ExpressionAttributeValues[':r']).toBe(
      '1/3-р оролдлого амжилтгүй: Үйлчилгээ унасан. Дахин оролдоно.'
    );
    expect(pushedStatuses()).toEqual(['PROCESSING', 'PENDING']);
    expect(sqsSend.mock.calls[0][0].input).toMatchObject({
      QueueUrl: 'https://sqs.example/queue',
      ReceiptHandle: 'rh-n1',
      VisibilityTimeout: 5,
    });
  });

  it('оролдлого бүрт backoff-ыг хоёр дахин нэмнэ', async () => {
    ddbSend
      .mockResolvedValueOnce({ Attributes: item('PROCESSING') })
      .mockResolvedValueOnce({ Attributes: item('PENDING') });
    deliverMock.mockRejectedValue(new TemporaryDeliveryError('down'));

    await run(record('n1', 2));

    expect(sqsSend.mock.calls[0][0].input.VisibilityTimeout).toBe(10);
  });

  it('оролдлого дуусвал FAILED болгож бууж өгнө', async () => {
    ddbSend
      .mockResolvedValueOnce({ Attributes: item('PROCESSING') })
      .mockResolvedValueOnce({ Attributes: item('FAILED') });
    deliverMock.mockRejectedValue(new TemporaryDeliveryError('Үйлчилгээ унасан'));

    const res = await run(record('n1', 3));

    expect(res.batchItemFailures).toEqual([]);
    expect(ddbInput(1).ExpressionAttributeValues).toMatchObject({
      ':s': 'FAILED',
      ':r': '3 оролдлогын дараа бууж өгөв: Үйлчилгээ унасан',
    });
    expect(sqsSend).not.toHaveBeenCalled();
  });

  it('ангилаагүй алдааг түр зуурын гэж үзнэ', async () => {
    ddbSend
      .mockResolvedValueOnce({ Attributes: item('PROCESSING') })
      .mockResolvedValueOnce({ Attributes: item('PENDING') });
    deliverMock.mockRejectedValue(new Error('socket hang up'));

    const res = await run(record());

    expect(res.batchItemFailures).toHaveLength(1);
    expect(ddbInput(1).ExpressionAttributeValues[':pending']).toBe('PENDING');
  });

  it('visibility timeout-ыг богиносгож чадаагүй ч алдааг зөв мэдээлнэ', async () => {
    ddbSend
      .mockResolvedValueOnce({ Attributes: item('PROCESSING') })
      .mockResolvedValueOnce({ Attributes: item('PENDING') });
    deliverMock.mockRejectedValue(new TemporaryDeliveryError('down'));
    sqsSend.mockRejectedValue(new Error('SQS unavailable'));

    const res = await run(record());

    expect(res.batchItemFailures).toEqual([{ itemIdentifier: 'm-n1' }]);
  });
});

describe('worker: давхар хүргэлт ба зэрэгцээ ажиллагаа', () => {
  it('claim хийхдээ атомик: зөвхөн PENDING, эсвэл хуучирсан PROCESSING lease-ээс', async () => {
    ddbSend.mockRejectedValueOnce(conflict());

    await run(record());

    const claim = ddbInput(0);
    expect(claim.ConditionExpression).toContain('#s = :pending');
    expect(claim.ConditionExpression).toContain('updatedAt < :staleBefore');
    expect(claim.ExpressionAttributeValues[':pending']).toBe('PENDING');
  });

  it('байхгүй, дууссан, эсвэл өөр worker-ийн авсан мөрийг алгасна', async () => {
    ddbSend.mockRejectedValueOnce(conflict());

    const res = await run(record());

    expect(res.batchItemFailures).toEqual([]);
    expect(ddbSend).toHaveBeenCalledTimes(1);
    expect(deliverMock).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('давхардсан message-ийг зөвхөн нэг удаа хүргэнэ', async () => {
    ddbSend
      .mockResolvedValueOnce({ Attributes: item('PROCESSING') })
      .mockResolvedValueOnce({ Attributes: item('COMPLETED') })
      .mockRejectedValueOnce(conflict());
    deliverMock.mockResolvedValue('ok');

    await run(record(), record());

    expect(deliverMock).toHaveBeenCalledTimes(1);
  });

  it('өөр worker аль хэдийн дуусгасан бол үр дүнг push хийхгүй', async () => {
    ddbSend.mockResolvedValueOnce({ Attributes: item('PROCESSING') }).mockRejectedValueOnce(conflict());
    deliverMock.mockResolvedValue('ok');

    await run(record());

    expect(pushedStatuses()).toEqual(['PROCESSING']);
  });
});

describe('worker: алдаа ба batch', () => {
  it('DynamoDB унавал record-ыг backoff-той дахин оролдоно', async () => {
    ddbSend.mockRejectedValueOnce(new Error('DynamoDB unavailable'));

    const res = await run(record());

    expect(res.batchItemFailures).toEqual([{ itemIdentifier: 'm-n1' }]);
    expect(deliverMock).not.toHaveBeenCalled();
    expect(sqsSend).toHaveBeenCalledTimes(1);
  });

  it('уншигдахгүй message-ийг DLQ руу явахаар үлдээнэ', async () => {
    const res = await run({ ...record(), body: 'not json' });

    expect(res.batchItemFailures).toEqual([{ itemIdentifier: 'm-n1' }]);
    expect(ddbSend).not.toHaveBeenCalled();
  });

  it('алдаатай нэг record batch-ийн бусдад нөлөөлөхгүй', async () => {
    ddbSend
      .mockResolvedValueOnce({ Attributes: item('PROCESSING', { id: 'a' }) })
      .mockResolvedValueOnce({ Attributes: item('PENDING', { id: 'a' }) })
      .mockResolvedValueOnce({ Attributes: item('PROCESSING', { id: 'b' }) })
      .mockResolvedValueOnce({ Attributes: item('COMPLETED', { id: 'b' }) });
    deliverMock
      .mockRejectedValueOnce(new TemporaryDeliveryError('down'))
      .mockResolvedValueOnce('ok');

    const res = await run(record('a'), record('b'));

    expect(res.batchItemFailures).toEqual([{ itemIdentifier: 'm-a' }]);
    expect(deliverMock).toHaveBeenCalledTimes(2);
  });

  it('push амжилтгүй болсон нь хадгалагдсан ажлыг буцаахгүй', async () => {
    ddbSend
      .mockResolvedValueOnce({ Attributes: item('PROCESSING') })
      .mockResolvedValueOnce({ Attributes: item('COMPLETED') });
    deliverMock.mockResolvedValue('ok');
    broadcast.mockRejectedValue(new Error('push failed'));

    const res = await run(record());

    expect(res.batchItemFailures).toEqual([]);
    expect(ddbSend).toHaveBeenCalledTimes(2);
  });
});
