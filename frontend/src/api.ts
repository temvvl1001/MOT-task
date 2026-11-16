import { AuthError, getValidSession } from './auth';
import { config } from './config';
import { errorText, t } from './i18n';
import type { CreateNotificationInput, Notification, NotificationPage } from './types';

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const request = async <T>(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}
): Promise<{ status: number; data: T }> => {
  const { idToken } = await getValidSession();

  let res: Response;
  try {
    res = await fetch(`${config.apiUrl}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${idToken}`,
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError(0, t.errors.network);
  }

  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new AuthError(t.errors.sessionExpired);
  // API асуудлыг `code`-оор нэрлэнэ; хэрэглэгчид харагдах текстийг i18n-ээс авна.
  if (!res.ok) throw new ApiError(res.status, errorText(data.code) ?? t.errors.generic, data.code);
  return { status: res.status, data: data as T };
};

export const listNotifications = async (nextToken?: string, limit = 20) => {
  const query = new URLSearchParams({ limit: String(limit) });
  if (nextToken) query.set('nextToken', nextToken);
  return (await request<NotificationPage>(`/notifications?${query}`)).data;
};

// Idempotency key нь давтагдсан хүсэлтийг аюулгүй болгоно: сервер хоёр дахь notification
// үүсгэхийн оронд анхных нь буцаана.
export const createNotification = async (input: CreateNotificationInput, idempotencyKey: string) => {
  const { status, data } = await request<Notification>('/notifications', {
    method: 'POST',
    body: input,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  // 202: хадгалагдсан ч дараалалд орох нь хойшилсон. Сервер удахгүй дараалалд оруулна.
  return { notification: data, delayed: status === 202 };
};
