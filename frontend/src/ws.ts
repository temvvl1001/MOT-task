import { config } from './config';
import type { Notification } from './types';

export type ConnectionState = 'connecting' | 'open' | 'closed';

interface Handlers {
  // (Дахин) холбогдох бүрийн өмнө дуудна, ингэснээр дахин холболт үргэлж шинэ token-той байна.
  getToken: () => Promise<string>;
  onUpdate: (notification: Notification) => void;
  onState: (state: ConnectionState) => void;
  // Тасалдлын дараа холболт сэргэсэн: энэ хооронд алдсаныг дахин татна.
  onReconnect: () => void;
  // Хүчинтэй token авах боломжгүй болсон.
  onAuthError: () => void;
}

const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 15_000;

export const reconnectDelay = (retries: number) => Math.min(BASE_DELAY_MS * 2 ** retries, MAX_DELAY_MS);

// Холболтыг бүрмөсөн хаадаг функц буцаана.
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
      // API Gateway идэвхгүй холболтыг 10 минутын дараа, бүх холболтыг 2 цагийн дараа таслана,
      // мөн сүлжээ хэдийд ч тасарч болно. Exponential backoff-оор дахин холбогдоно.
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
