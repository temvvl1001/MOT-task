import type { CreateNotificationInput, Notification } from './types';

const API_URL = import.meta.env.VITE_API_URL as string;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    throw new Error('Network error. Could not reach the server.');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export const createNotification = (input: CreateNotificationInput) =>
  request<Notification>('/notifications', {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const listNotifications = () => request<Notification[]>('/notifications');