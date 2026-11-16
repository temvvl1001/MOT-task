import { config } from './config';
import { t } from './i18n';

// Sign-up and sign-in talk to the Cognito API directly; no SDK is needed for four calls.

export class AuthError extends Error {}

export interface Session {
  email: string;
  idToken: string;
  refreshToken: string;
  // epoch milliseconds
  expiresAt: number;
}

const STORAGE_KEY = 'notifications.session';
// Refresh a little before the token really expires so a request never goes out with a stale one.
const REFRESH_MARGIN_MS = 60_000;

export const authMessage = (type: string | undefined): string => {
  switch (type) {
    // Cognito answers UserNotFoundException only because PreventUserExistenceErrors is LEGACY in
    // serverless.yml. With the default (ENABLED) both cases would look like NotAuthorizedException.
    case 'UserNotFoundException':
      return t.auth.notRegistered;
    case 'NotAuthorizedException':
      return t.auth.wrongCredentials;
    case 'UsernameExistsException':
      return 'Энэ имэйлээр бүртгэл аль хэдийн үүссэн байна. Нэвтэрнэ үү.';
    case 'InvalidPasswordException':
      return t.auth.passwordHint;
    case 'InvalidParameterException':
      return 'Имэйл эсвэл нууц үгийн хэлбэр буруу байна. Шалгаад дахин оролдоно уу.';
    case 'TooManyRequestsException':
    case 'LimitExceededException':
      return 'Хэт олон оролдлого хийлээ. Түр хүлээгээд дахин оролдоно уу.';
    default:
      return t.auth.failed;
  }
};

const cognito = async (target: string, body: unknown) => {
  let res: Response;
  try {
    res = await fetch(`https://cognito-idp.${config.region}.amazonaws.com/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AuthError(t.errors.authNetwork);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new AuthError(authMessage(data.__type?.split('#').pop()));
  return data;
};

const toSession = (
  email: string,
  result: { IdToken: string; RefreshToken?: string; ExpiresIn: number },
  previousRefreshToken?: string
): Session => ({
  email,
  idToken: result.IdToken,
  // A refresh call does not return a new refresh token; keep the one we have.
  refreshToken: result.RefreshToken ?? previousRefreshToken ?? '',
  expiresAt: Date.now() + result.ExpiresIn * 1000,
});

export const saveSession = (session: Session) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Storage can be unavailable (private mode). The user simply signs in again next time.
  }
};

export const clearSession = () => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
};

export const loadSession = (): Session | null => {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (
      raw &&
      typeof raw.email === 'string' &&
      typeof raw.idToken === 'string' &&
      typeof raw.refreshToken === 'string' &&
      typeof raw.expiresAt === 'number'
    ) {
      return raw as Session;
    }
  } catch {
    // fall through
  }
  return null;
};

export const signIn = async (email: string, password: string): Promise<Session> => {
  const data = await cognito('InitiateAuth', {
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: config.clientId,
    AuthParameters: { USERNAME: email, PASSWORD: password },
  });
  const session = toSession(email, data.AuthenticationResult);
  saveSession(session);
  return session;
};

export const signUp = async (email: string, password: string): Promise<Session> => {
  await cognito('SignUp', {
    ClientId: config.clientId,
    Username: email,
    Password: password,
    UserAttributes: [{ Name: 'email', Value: email }],
  });
  return signIn(email, password);
};

export const signOut = clearSession;

// The token to put on the next request. Refreshes it when it is about to expire and signs the
// user out (AuthError) when that is no longer possible.
export const getValidSession = async (): Promise<Session> => {
  const session = loadSession();
  if (!session) throw new AuthError(t.errors.pleaseSignIn);
  if (session.expiresAt - REFRESH_MARGIN_MS > Date.now()) return session;

  try {
    const data = await cognito('InitiateAuth', {
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: config.clientId,
      AuthParameters: { REFRESH_TOKEN: session.refreshToken },
    });
    const refreshed = toSession(session.email, data.AuthenticationResult, session.refreshToken);
    saveSession(refreshed);
    return refreshed;
  } catch {
    clearSession();
    throw new AuthError(t.errors.sessionExpired);
  }
};
