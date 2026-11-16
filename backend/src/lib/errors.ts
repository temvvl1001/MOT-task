// Delivery failures come in two kinds and the worker treats them differently.

// Retrying cannot help (invalid address, recipient rejected the message).
// The notification is marked FAILED immediately.
export class PermanentDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentDeliveryError';
  }
}

// Retrying may help (provider outage, throttling, timeout).
// The notification goes back to PENDING and SQS redelivers it after a backoff.
export class TemporaryDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemporaryDeliveryError';
  }
}
