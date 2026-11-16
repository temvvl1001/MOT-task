import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PermanentDeliveryError, TemporaryDeliveryError } from './errors';
import { deliver, FLAKY_RECOVERS_ON_ATTEMPT } from './deliver';
import type { Notification } from './types';

const to = (recipient: string): Notification => ({
  id: 'n1',
  userId: 'user-1',
  recipient,
  channel: 'EMAIL',
  message: 'Hello',
  status: 'PROCESSING',
  attempts: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

// deliver() 1-3 секунд хүлээдэг тул тестэд хуурамч цаг ашиглаж шууд дуусгана.
const settle = async (recipient: string, attempt: number) => {
  const outcome = deliver(to(recipient), attempt).then(
    (value) => ({ value }),
    (error) => ({ error })
  );
  await vi.advanceTimersByTimeAsync(3000);
  return outcome;
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('deliver', () => {
  it('ердийн хүлээн авагчид хүргэнэ', async () => {
    const res = await settle('bold@example.com', 1);

    expect(res).toEqual({ value: 'EMAIL сувгаар bold@example.com хаяг руу амжилттай хүргэлээ' });
  });

  it('"fail" хүлээн авагчийг оролдлого хэд ч байсан байнгын алдаагаар татгалзана', async () => {
    for (const attempt of [1, 2, 3]) {
      const res = await settle('Fail@example.com', attempt);
      expect((res as { error: unknown }).error).toBeInstanceOf(PermanentDeliveryError);
    }
  });

  it('"flaky" хүлээн авагч сэргэх хүртлээ түр зуурын алдаа өгнө', async () => {
    for (let attempt = 1; attempt < FLAKY_RECOVERS_ON_ATTEMPT; attempt++) {
      const res = await settle('flaky@example.com', attempt);
      expect((res as { error: unknown }).error).toBeInstanceOf(TemporaryDeliveryError);
    }

    const recovered = await settle('flaky@example.com', FLAKY_RECOVERS_ON_ATTEMPT);
    expect(recovered).toEqual({
      value: 'EMAIL сувгаар flaky@example.com хаяг руу амжилттай хүргэлээ',
    });
  });

  it('"outage" хүлээн авагч оролдлого бүрд түр зуурын алдаа өгнө', async () => {
    for (const attempt of [1, 2, 3, 4]) {
      const res = await settle('outage@example.com', attempt);
      expect((res as { error: unknown }).error).toBeInstanceOf(TemporaryDeliveryError);
    }
  });

  it('алдааны хоёр төрлийг хоорондоо ялгана', () => {
    expect(new TemporaryDeliveryError('x')).not.toBeInstanceOf(PermanentDeliveryError);
    expect(new PermanentDeliveryError('x')).not.toBeInstanceOf(TemporaryDeliveryError);
  });
});
