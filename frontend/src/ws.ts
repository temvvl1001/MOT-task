import { config } from './config';
import type { Notification } from './types';

export type ConnectionState = 'connecting' | 'open' | 'closed';

interface Handlers {
  // Called before every (re)connect, so a reconnect always carries a fresh token.
  getToken: () => Promise<string>;
  onUpdate: (notification: Notification) => void;
  onState: (state: ConnectionState) => void;
  // The connection came back after an outage: refetch what was missed meanwhile.
  onReconnect: () => void;
  // No valid token can be obtained any more.
  onAuthError: () => void;
}

const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 15_000;

export const reconnectDelay = (retries: number) => Math.min(BASE_DELAY_MS * 2 ** retries, MAX_DELAY_MS);

// Returns a function that closes the connection for good.
export function connectWebSocket({ getToken, onUpdate, onState, onReconnect, onAuthError }: Handlers) {
  let socket: WebSocket | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let retries = 0;
  let stopped = false;

  const open = async () => {
    if (stopped) return;
    onState('connecting');

    let token: string;
    try {
      token = await getToken();
    } catch {
      onAuthError();
      return;
    }
    if (stopped) return;

    const ws = new WebSocket(`${config.wsUrl}?token=${encodeURIComponent(token)}`);
    socket = ws;

    ws.onopen = () => {
      const wasOffline = retries > 0;
      retries = 0;
      onState('open');
      if (wasOffline) onReconnect();
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'NOTIFICATION_UPDATED') onUpdate(message.notification);
      } catch (err) {
        console.error('Ignoring an unreadable WebSocket message', err);
      }
    };

    ws.onclose = () => {
      if (socket !== ws) return;
      onState('closed');
      if (stopped) return;
      // API Gateway ends idle connections after 10 minutes and every connection after 2 hours,
      // and the network can drop at any time. Reconnect with exponential backoff.
      timer = setTimeout(open, reconnectDelay(retries));
      retries += 1;
    };
  };

  void open();

  return () => {
    stopped = true;
    clearTimeout(timer);
    socket?.close();
  };
}
