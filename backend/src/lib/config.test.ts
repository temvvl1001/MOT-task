import { describe, expect, it } from 'vitest';
import { LEASE_MS, RETENTION_SECONDS, retryDelaySeconds } from './config';

describe('retryDelaySeconds', () => {
  it('5 секундээс эхлэн экспоненциалаар нэмэгдэнэ', () => {
    expect([1, 2, 3, 4].map(retryDelaySeconds)).toEqual([5, 10, 20, 40]);
  });

  it('дээд хязгаартай тул message хэт удаан далд байхгүй', () => {
    expect(retryDelaySeconds(20)).toBe(300);
  });
});

describe('RETENTION_SECONDS', () => {
  it('90 хоног', () => {
    expect(RETENTION_SECONDS).toBe(90 * 24 * 60 * 60);
  });
});

describe('LEASE_MS', () => {
  it('worker-ийн timeout-оос урт тул ажиллаж буй worker-ийг хэн ч түрэхгүй', () => {
    const workerTimeoutMs = 60_000; // serverless.yml: worker-ийн timeout
    expect(LEASE_MS).toBeGreaterThan(workerTimeoutMs);
  });
});
