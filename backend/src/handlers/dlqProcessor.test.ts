import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import type { SQSEvent } from 'aws-lambda';

vi.mock('../lib/clients', () => ({ ddb: { send: vi.fn() } }));
vi.mock('../lib/broadcast', () => ({ broadcastNotification: vi.fn() }));

import { ddb } from '../lib/clients';
import { broadcastNotification } from '../lib/broadcast';
import { handler } from './dlqProcessor';

const send = ddb.send as unknown as Mock;
const broadcast = broadcastNotification as unknown as Mock;

const run = (...bodies: string[]) =>
  handler(
    { Records: bodies.map((body, i) => ({ messageId: `m${i}`, body })) } as unknown as SQSEvent,
    {} as never,
    () => undefined
  );

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  process.env.NOTIFICATIONS_TABLE = 'notifications-table';
});

describe('dlqProcessor', () => {
  it('dead-letter болсон notification-ийг FAILED болгож, эзэмшигчид нь мэдэгдэнэ', async () => {
    send.mockResolvedValueOnce({ Attributes: { id: 'n1', userId: 'user-1', status: 'FAILED' } });

    await run(JSON.stringify({ id: 'n1' }));

    expect(send.mock.calls[0][0].input.Key).toEqual({ id: 'n1' });
    expect(send.mock.calls[0][0].input.ExpressionAttributeValues[':failed']).toBe('FAILED');
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ id: 'n1', status: 'FAILED' }));
  });

  it('аль хэдийн дууссан notification-д хүрэхгүй', async () => {
    send.mockRejectedValueOnce(
      new ConditionalCheckFailedException({ message: 'finished', $metadata: {} })
    );

    await run(JSON.stringify({ id: 'n1' }));

    expect(broadcast).not.toHaveBeenCalled();
  });

  it('уншигдахгүй message-ийг алгасаж, batch-ийг унагахгүй', async () => {
    await expect(run('not json')).resolves.toBeUndefined();

    expect(send).not.toHaveBeenCalled();
  });
});
