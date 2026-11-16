import type { CreateNotificationInput } from './types';

// One Idempotency-Key stands for one request. Sending the same content again (after a timeout, a
// double click, a lost response) must reuse the key so the server creates only one notification.
// Sending different content must use a new key, otherwise the server rejects it as a key reuse.
export interface Attempt {
  key: string;
  content: string;
}

// What makes two requests "the same": the values the server stores (it trims them as well).
export const contentOf = (input: CreateNotificationInput): string =>
  JSON.stringify({
    recipient: input.recipient.trim(),
    channel: input.channel,
    message: input.message.trim(),
  });

export const attemptFor = (
  current: Attempt,
  content: string,
  newKey: () => string = () => crypto.randomUUID()
): Attempt => (current.content === content ? current : { key: newKey(), content });
