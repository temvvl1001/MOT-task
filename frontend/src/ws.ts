import type { Notification } from './types';

const WS_URL = import.meta.env.VITE_WS_URL as string;

export type ConnectionState = 'connecting' | 'open' | 'closed';

interface Handlers {
  onUpdate: (notification: Notification) => void;
  onState: (state: ConnectionState) => void;
  onReconnect: () => void;
}

export function connectWebSocket({ onUpdate, onState, onReconnect }: Handlers) {
  let socket: WebSocket;
  let retries = 0;
  let stopped = false;

  const open = () => {
    onState('connecting');
    socket = new WebSocket(WS_URL);

    socket.onopen = () => {
      const isReconnect = retries > 0;
      retries = 0;
      onState('open');
      if (isReconnect) onReconnect();
    };

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'NOTIFICATION_UPDATED') onUpdate(message.notification);
      } catch (err) {
        console.error('Invalid WebSocket message', err);
      }
    };

    socket.onclose = () => {
      onState('closed');
      if (stopped) return;
      const delay = Math.min(1000 * 2 ** retries, 15000);
      retries++;
      setTimeout(open, delay);
    };
  };

  open();

  return () => {
    stopped = true;
    socket.close();
  };
}