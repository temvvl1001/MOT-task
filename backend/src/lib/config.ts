// How many times SQS delivers a message before it is dead-lettered. Kept in one place:
// serverless.yml feeds the same number to the queue's redrive policy and to this env var.
export const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS ?? 3);

// The worker Lambda times out after 60 s. A PROCESSING item that has not been touched for
// longer than this is treated as abandoned and may be claimed again.
export const LEASE_MS = 120_000;

// A PENDING item nobody picked up for this long was probably never enqueued.
export const STALE_PENDING_MS = Number(process.env.STALE_PENDING_MS ?? 120_000);

// Notifications are deleted by DynamoDB's TTL this long after they were created.
export const RETENTION_SECONDS = 90 * 24 * 60 * 60;

// Backoff before SQS redelivers a message after a temporary failure: 5 s, 10 s, 20 s ... capped.
export const retryDelaySeconds = (attempt: number) => Math.min(5 * 2 ** (attempt - 1), 300);
