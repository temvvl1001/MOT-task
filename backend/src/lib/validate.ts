import type { ApiErrorBody } from './http';

export const CHANNELS = ['EMAIL', 'SMS', 'PUSH'] as const;
export type Channel = (typeof CHANNELS)[number];
export const MAX_MESSAGE_LENGTH = 500;

// "something@domain.tld": хоосон зайгүй, яг нэг @, хоосон биш хэсгүүдээс тогтсон, дор хаяж нэг цэгтэй домэйн.
// RFC 5322-ыг бүрэн шалгах нь үнэ цэнэгүй; хаяг ажиллаж байгаагийн жинхэнэ баталгаа нь хүргэгдсэн мессеж.
const EMAIL = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
const MAX_EMAIL_LENGTH = 254;
// Олон улсын дугаар, эхэнд сонголтоор +, 8-15 орон (E.164), зай болон зураас зөвшөөрнө.
const PHONE = /^\+?\d{8,15}$/;
// Төхөөрөмжийн token эсвэл хэрэглэгчийн id: хоосон зайгүй 3-128 тэмдэгт.
const DEVICE_ID = /^\S{3,128}$/;

// Зөв хүлээн авагч ямар байх нь notification-ийг хэрхэн илгээхээс хамаарна.
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

// Олдсон эхний алдааг буцаана, зөв бол null.
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
  // Хэлбэр шалгахад суваг хэрэгтэй тул суваг зөвшөөрөгдсөний дараа хийнэ.
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
