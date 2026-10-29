export const CHANNELS = ['EMAIL', 'SMS', 'PUSH'] as const;
export const MAX_MESSAGE_LENGTH = 500;

export const validateCreateInput = (body: unknown): string | null => {
  if (!body || typeof body !== 'object') return 'Request body must be a JSON object';

  const { recipient, channel, message } = body as Record<string, unknown>;

  if (typeof recipient !== 'string' || !recipient.trim()) return 'recipient is required';
  if (typeof channel !== 'string' || !(CHANNELS as readonly string[]).includes(channel))
    return `channel must be one of ${CHANNELS.join(', ')}`;
  if (typeof message !== 'string' || !message.trim()) return 'message is required';
  if (message.length > MAX_MESSAGE_LENGTH)
    return `message must be ${MAX_MESSAGE_LENGTH} characters or less`;

  return null;
};