import type { ApiErrorBody } from './http';

export const CHANNELS = ['EMAIL', 'SMS', 'PUSH'] as const;
export const MAX_MESSAGE_LENGTH = 500;

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
