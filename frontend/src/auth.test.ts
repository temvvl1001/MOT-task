import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./config', () => ({ config: { region: 'ap-southeast-2', clientId: 'client-1' } }));

import { AuthError, authMessage, getValidSession, loadSession, signIn, signUp, type Session } from './auth';
import { t } from './i18n';

const memoryStorage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
};

const session = (expiresInMs: number): Session => ({
  email: 'bold@example.com',
  idToken: 'old-id-token',
  refreshToken: 'refresh-1',
  expiresAt: Date.now() + expiresInMs,
});

const reply = (status: number, body: unknown) =>
  Promise.resolve({ ok: status < 400, status, json: async () => body } as Response);

const target = (call: unknown[]) => (call[1] as RequestInit & { headers: Record<string, string> }).headers['X-Amz-Target'];
const sentBody = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getValidSession', () => {
  it('session байхгүй бол нэвтрэхийг шаардана', async () => {
    await expect(getValidSession()).rejects.toBeInstanceOf(AuthError);
  });

  it('хугацаа нь хүчинтэй токенийг Cognito-д хандалгүй буцаана', async () => {
    localStorage.setItem('notifications.session', JSON.stringify(session(10 * 60_000)));

    const result = await getValidSession();

    expect(result.idToken).toBe('old-id-token');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('дуусах гэж буй токенийг шинэчилж, refresh token-ыг хэвээр хадгална', async () => {
    localStorage.setItem('notifications.session', JSON.stringify(session(10_000)));
    fetchMock.mockReturnValue(
      reply(200, { AuthenticationResult: { IdToken: 'new-id-token', ExpiresIn: 3600 } })
    );

    const result = await getValidSession();

    expect(target(fetchMock.mock.calls[0])).toBe('AWSCognitoIdentityProviderService.InitiateAuth');
    expect(sentBody(fetchMock.mock.calls[0])).toMatchObject({
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      AuthParameters: { REFRESH_TOKEN: 'refresh-1' },
    });
    expect(result).toMatchObject({ idToken: 'new-id-token', refreshToken: 'refresh-1' });
    expect(loadSession()?.idToken).toBe('new-id-token');
  });

  it('refresh token ажиллахаа больсон бол хэрэглэгчийг гаргана', async () => {
    localStorage.setItem('notifications.session', JSON.stringify(session(-1000)));
    fetchMock.mockReturnValue(reply(400, { __type: 'NotAuthorizedException' }));

    await expect(getValidSession()).rejects.toBeInstanceOf(AuthError);
    expect(loadSession()).toBeNull();
  });
});

describe('signIn ба signUp', () => {
  const tokens = { AuthenticationResult: { IdToken: 'id', RefreshToken: 'refresh', ExpiresIn: 3600 } };

  it('signIn нь session-ийг хадгална', async () => {
    fetchMock.mockReturnValue(reply(200, tokens));

    const result = await signIn('bold@example.com', 'secret123');

    expect(sentBody(fetchMock.mock.calls[0])).toMatchObject({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: 'client-1',
    });
    expect(result.idToken).toBe('id');
    expect(loadSession()?.email).toBe('bold@example.com');
  });

  it('signUp нь бүртгэл үүсгээд дараа нь нэвтэрнэ', async () => {
    fetchMock.mockReturnValueOnce(reply(200, {})).mockReturnValueOnce(reply(200, tokens));

    await signUp('bold@example.com', 'secret123');

    expect(fetchMock.mock.calls.map(target)).toEqual([
      'AWSCognitoIdentityProviderService.SignUp',
      'AWSCognitoIdentityProviderService.InitiateAuth',
    ]);
  });

  it('буруу нууц үгэнд ойлгомжтой монгол мессеж өгч, юу ч хадгалахгүй', async () => {
    fetchMock.mockReturnValue(
      reply(400, { __type: 'NotAuthorizedException', message: 'Incorrect username or password.' })
    );

    await expect(signIn('bold@example.com', 'wrong')).rejects.toThrow(
      'Имэйл эсвэл нууц үг буруу байна.'
    );
    expect(loadSession()).toBeNull();
  });

  it('сүлжээний алдааг унахгүйгээр ойлгомжтой мэдээлнэ', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(signIn('bold@example.com', 'x')).rejects.toThrow(t.errors.authNetwork);
  });
});

describe('authMessage', () => {
  it.each([
    ['NotAuthorizedException', 'Имэйл эсвэл нууц үг буруу байна.'],
    ['UsernameExistsException', 'Энэ имэйлээр бүртгэл аль хэдийн үүссэн байна. Нэвтэрнэ үү.'],
    ['InvalidPasswordException', t.auth.passwordHint],
  ])('%s-ийг монгол текст болгоно', (type, expected) => {
    expect(authMessage(type)).toBe(expected);
  });

  it('үл мэдэгдэх алдаанд ерөнхий мессеж өгнө', () => {
    expect(authMessage('SomethingNew')).toBe(t.auth.failed);
    expect(authMessage(undefined)).toBe(t.auth.failed);
  });
});

describe('loadSession', () => {
  it('эвдэрсэн хадгалалтыг үл тооно', () => {
    localStorage.setItem('notifications.session', '{not json');

    expect(loadSession()).toBeNull();
  });

  it('буруу бүтэцтэй session-ийг үл тооно', () => {
    localStorage.setItem('notifications.session', JSON.stringify({ email: 'x' }));

    expect(loadSession()).toBeNull();
  });
});
