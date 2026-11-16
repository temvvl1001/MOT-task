import type { ApiErrorBody } from './http';

export const CHANNELS = ['EMAIL', 'SMS', 'PUSH'] as const;
export type Channel = (typeof CHANNELS)[number];
export const MAX_MESSAGE_LENGTH = 500;

// "something@domain.tld": no spaces, exactly one @, a domain made of non-empty labels with at least one
// dot. A full RFC 5322 check is not worth it; the real proof that an address works is a delivered message.
const EMAIL = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
const MAX_EMAIL_LENGTH = 254;
// International number with an optional leading +, 8 to 15 digits (E.164), spaces and dashes allowed.
const PHONE = /^\+?\d{8,15}$/;
// A device token or user id: 3-128 characters without whitespace.
const DEVICE_ID = /^\S{3,128}$/;

// What a valid recipient looks like depends on how the notification is sent.
const recipientIssue = (channel: Channel, recipient: string): ApiErrorBody | null => {
  switch (channel) {
    case 'EMAIL':
      return EMAIL.test(recipient) && recipient.length <= MAX_EMAIL_LENGTH
        ? null
        : { code: 'invalid_recipient_email', error: 'recipient must be a valid email address' };
    case 'SMS':
      return PHONE.test(recipient.replace(/[\s-]/g, ''))
        ? null
        : { code: 'invalid_recipient_phone', error: 'recipient must be a phone number with 8-15 digits' };
    case 'PUSH':
      return DEVICE_ID.test(recipient)
        ? null
        : { code: 'invalid_recipient_device', error: 'recipient must be 3-128 characters without spaces' };
  }
};

// Returns the first problem found, or null when the input is valid.
export const validateCreateInput = (body: unknown): ApiErrorBody | null => {
  if (!body || typeof body !== 'object') {
    return { code: 'invalid_body', error: 'Request body must be a JSON object' };
  }

  const { recipient, channel, message } = body as Record<string, unknown>;

  if (typeof recipient !== 'string' || !recipient.trim()) {
    return { code: 'recipient_required', error: 'recipient is required' };
  }
  if (typeof channel !== 'string' || !(CHANNELS as readonly string[]).includes(channel)) {
    return { code: 'invalid_channel', error: `channel must be one of ${CHANNELS.join(', ')}` };
  }
  // The format check needs the channel, so it comes after the channel was accepted.
  const issue = recipientIssue(channel as Channel, recipient.trim());
  if (issue) return issue;

  if (typeof message !== 'string' || !message.trim()) {
    return { code: 'message_required', error: 'message is required' };
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return {
      code: 'message_too_long',
      error: `message must be ${MAX_MESSAGE_LENGTH} characters or less`,
    };
  }

  return null;
};
