import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./config', () => ({ config: { apiUrl: 'https://api.test' } }));
vi.mock('./auth', () => {
  class AuthError extends Error {}
  return { AuthError, getValidSession: vi.fn().mockResolvedValue({ idToken: 'id-token' }) };
});

import { ApiError, createNotification, listNotifications } from './api';
import { AuthError } from './auth';
import { t } from './i18n';

const reply = (status: number, body: unknown) =>
  Promise.resolve({ ok: status < 400, status, json: async () => body } as Response);

let fetchMock: ReturnType<typeof vi.fn>;
const sent = () => fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

describe('createNotification', () => {
  const input = { recipient: 'bold@example.com', channel: 'EMAIL' as const, message: 'Hello' };

  it('токен болон idempotency key-г илгээнэ', async () => {
    fetchMock.mockReturnValue(reply(201, { id: 'n1' }));

    await createNotification(input, 'key-1234567');

    const [url, init] = sent();
    expect(url).toBe('https://api.test/notifications');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer id-token',
      'Idempotency-Key': 'key-1234567',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init.body as string)).toEqual(input);
  });

  it('201 хариуг хойшилсон гэж тэмдэглэхгүй', async () => {
    fetchMock.mockReturnValue(reply(201, { id: 'n1' }));

    expect(await createNotification(input, 'key-1234567')).toEqual({
      notification: { id: 'n1' },
      delayed: false,
    });
  });

  it('202 хариуг (хадгалагдсан, дараалалд орох нь хойшилсон) хойшилсон гэж тэмдэглэнэ', async () => {
    fetchMock.mockReturnValue(reply(202, { id: 'n1' }));

    expect((await createNotification(input, 'key-1234567')).delayed).toBe(true);
  });

  it('API-ийн алдааны кодыг хэрэглэгчид ойлгомжтой монгол текст болгоно', async () => {
    fetchMock.mockReturnValue(
      reply(400, { code: 'recipient_required', error: 'recipient is required' })
    );

    const error = await createNotification(input, 'key-1234567').catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe(t.errors.codes.recipient_required);
    expect(error.code).toBe('recipient_required');
    expect(error.status).toBe(400);
  });

  it('frontend-ийн мэдэхгүй кодод ерөнхий мессеж өгч, англи тайлбарыг хэрэглэгчид үзүүлэхгүй', async () => {
    fetchMock.mockReturnValue(reply(400, { code: 'brand_new_code', error: 'Some English text' }));

    await expect(createNotification(input, 'key-1234567')).rejects.toThrow(t.errors.generic);
  });

  it('401-ийг AuthError болгож, хэрэглэгчийг гаргана', async () => {
    fetchMock.mockReturnValue(reply(401, { message: 'Unauthorized' }));

    await expect(createNotification(input, 'key-1234567')).rejects.toBeInstanceOf(AuthError);
  });

  it('сүлжээний алдааг ойлгомжтой мессеж болгоно', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const error = await createNotification(input, 'key-1234567').catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe(t.errors.network);
  });

  it('body-гүй алдааны хариунд ерөнхий мессеж өгнө', async () => {
    fetchMock.mockReturnValue(
      Promise.resolve({ ok: false, status: 500, json: async () => { throw new Error('no body'); } } as unknown as Response)
    );

    await expect(createNotification(input, 'key-1234567')).rejects.toThrow(t.errors.generic);
  });
});

describe('listNotifications', () => {
  it('анхдагч хэмжээгээр эхний хуудсыг асууна', async () => {
    fetchMock.mockReturnValue(reply(200, { items: [] }));

    await listNotifications();

    expect(sent()[0]).toBe('https://api.test/notifications?limit=20');
    expect(sent()[1].headers.Authorization).toBe('Bearer id-token');
  });

  it('өмнөх хуудасны cursor-ыг URL-д зөв кодлон дамжуулна', async () => {
    fetchMock.mockReturnValue(reply(200, { items: [] }));

    await listNotifications('a+b/c=', 5);

    expect(sent()[0]).toBe('https://api.test/notifications?limit=5&nextToken=a%2Bb%2Fc%3D');
  });
});
