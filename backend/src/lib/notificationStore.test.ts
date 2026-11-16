import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';

vi.mock('./clients', () => ({ ddb: { send: vi.fn() } }));

import { ddb } from './clients';
import { claim, failUnfinished, finish, release } from './notificationStore';

const send = ddb.send as unknown as Mock;
const input = () => send.mock.calls[0][0].input;
const conflict = () =>
  new ConditionalCheckFailedException({ message: 'conflict', $metadata: {} });

beforeEach(() => {
  vi.resetAllMocks();
  process.env.NOTIFICATIONS_TABLE = 'notifications-table';
});

describe('notificationStore: status шилжилтүүд', () => {
  it('claim: PENDING эсвэл хуучирсан PROCESSING lease -> PROCESSING, оролдлогыг тэмдэглэнэ', async () => {
    send.mockResolvedValue({ Attributes: { id: 'n1' } });

    await claim('n1', 2);

    expect(input().ConditionExpression).toBe(
      '#s = :pending OR (#s = :processing AND updatedAt < :staleBefore)'
    );
    expect(input().ExpressionAttributeValues).toMatchObject({
      ':processing': 'PROCESSING',
      ':attempt': 2,
    });
    expect(input().Key).toEqual({ id: 'n1' });
    expect(input().TableName).toBe('notifications-table');
  });

  it('claim: lease өнгөрсөн хугацаанд байх тул зөвхөн орхигдсон ажлыг л авч болно', async () => {
    send.mockResolvedValue({ Attributes: {} });
    const before = Date.now();

    await claim('n1', 1);

    const staleBefore = Date.parse(input().ExpressionAttributeValues[':staleBefore']);
    expect(staleBefore).toBeLessThan(before - 60_000);
  });

  it('finish: зөвхөн PROCESSING-ээс', async () => {
    send.mockResolvedValue({ Attributes: {} });

    await finish('n1', 'COMPLETED', 'done');

    expect(input().ConditionExpression).toBe('#s = :processing');
    expect(input().ExpressionAttributeValues).toMatchObject({ ':s': 'COMPLETED', ':r': 'done' });
  });

  it('release: зөвхөн PROCESSING-ээс, PENDING рүү буцаана', async () => {
    send.mockResolvedValue({ Attributes: {} });

    await release('n1', 'try again');

    expect(input().ConditionExpression).toBe('#s = :processing');
    expect(input().ExpressionAttributeValues).toMatchObject({ ':pending': 'PENDING', ':r': 'try again' });
  });

  it('failUnfinished: PENDING эсвэл PROCESSING-ээс, дууссан төлвөөс хэзээ ч биш', async () => {
    send.mockResolvedValue({ Attributes: {} });

    await failUnfinished('n1', 'dead-lettered');

    expect(input().ConditionExpression).toBe('#s = :pending OR #s = :processing');
    expect(input().ExpressionAttributeValues[':failed']).toBe('FAILED');
  });

  it.each([
    ['claim', () => claim('n1', 1)],
    ['finish', () => finish('n1', 'FAILED', 'x')],
    ['release', () => release('n1', 'x')],
    ['failUnfinished', () => failUnfinished('n1', 'x')],
  ])('%s нөхцөл биелэхгүй бол null буцаана', async (_name, call) => {
    send.mockRejectedValue(conflict());

    await expect(call()).resolves.toBeNull();
  });

  it('өрсөлдөөнд ялагдсан биш бусад алдааг дахин шидэнэ', async () => {
    send.mockRejectedValue(new Error('DynamoDB unavailable'));

    await expect(claim('n1', 1)).rejects.toThrow('DynamoDB unavailable');
  });
});
