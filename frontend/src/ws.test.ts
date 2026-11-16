import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('./config', () => ({ config: { wsUrl: 'wss://example.test/dev' } }));

import { connectWebSocket, reconnectDelay } from './ws';

// A WebSocket that tests drive by hand.
class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  close() {
    this.closed = true;
    this.onclose?.();
  }
  open() { this.onopen?.(); }
  receive(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) }); }
  drop() { this.onclose?.(); }
}

const flush = () => vi.advanceTimersByTimeAsync(0);

const setup = (getToken: Mock = vi.fn().mockResolvedValue('token-1')) => {
  const handlers = {
    getToken,
    onUpdate: vi.fn(),
    onState: vi.fn(),
    onReconnect: vi.fn(),
    onAuthError: vi.fn(),
  };
  const stop = connectWebSocket(handlers);
  return { handlers, stop };
};

beforeEach(() => {
  FakeSocket.instances = [];
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('connectWebSocket', () => {
  it('токенийг query-д тавьж холбогдоно', async () => {
    setup(vi.fn().mockResolvedValue('a b/c'));
    await flush();

    expect(FakeSocket.instances[0].url).toBe('wss://example.test/dev?token=a%20b%2Fc');
  });

  it('эхлээд connecting, дараа нь open гэж мэдээлнэ', async () => {
    const { handlers } = setup();
    await flush();
    FakeSocket.instances[0].open();

    expect(handlers.onState.mock.calls.map(([s]) => s)).toEqual(['connecting', 'open']);
  });

  it('NOTIFICATION_UPDATED message-ийг дамжуулж, бусдыг үл тооно', async () => {
    const { handlers } = setup();
    await flush();
    const socket = FakeSocket.instances[0];
    socket.open();

    socket.receive({ type: 'NOTIFICATION_UPDATED', notification: { id: 'n1' } });
    socket.receive({ type: 'SOMETHING_ELSE' });
    socket.onmessage?.({ data: 'not json' });

    expect(handlers.onUpdate).toHaveBeenCalledTimes(1);
    expect(handlers.onUpdate).toHaveBeenCalledWith({ id: 'n1' });
  });

  it('тасрахад шинэ токеноор дахин холбогдож, апп-д жагсаалтыг дахин татахыг хэлнэ', async () => {
    const getToken = vi.fn().mockResolvedValueOnce('token-1').mockResolvedValueOnce('token-2');
    const { handlers } = setup(getToken);
    await flush();
    FakeSocket.instances[0].open();
    expect(handlers.onReconnect).not.toHaveBeenCalled();

    FakeSocket.instances[0].drop();
    await vi.advanceTimersByTimeAsync(reconnectDelay(0));
    FakeSocket.instances[1].open();

    expect(FakeSocket.instances[1].url).toContain('token=token-2');
    expect(handlers.onState.mock.calls.map(([s]) => s)).toEqual([
      'connecting', 'open', 'closed', 'connecting', 'open',
    ]);
    expect(handlers.onReconnect).toHaveBeenCalledTimes(1);
  });

  it('амжилтгүй оролдлого бүрийн дараа улам удаан хүлээж, дээд хязгаартай', () => {
    expect([0, 1, 2, 3].map(reconnectDelay)).toEqual([1000, 2000, 4000, 8000]);
    expect(reconnectDelay(10)).toBe(15_000);
  });

  it('холболт амжилттай болмогц backoff-ыг эхнээс нь эхэлнэ', async () => {
    setup();
    await flush();
    FakeSocket.instances[0].drop(); // never opened: failed attempt
    await vi.advanceTimersByTimeAsync(reconnectDelay(0));
    FakeSocket.instances[1].open(); // success resets the counter
    FakeSocket.instances[1].drop();
    await vi.advanceTimersByTimeAsync(reconnectDelay(0) - 1);
    expect(FakeSocket.instances).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(1);

    expect(FakeSocket.instances).toHaveLength(3);
  });

  it('токен авч чадахгүй бол оролдлогоо зогсоож нэвтрэлтийн алдаа мэдээлнэ', async () => {
    const { handlers } = setup(vi.fn().mockRejectedValue(new Error('expired')));
    await flush();

    expect(handlers.onAuthError).toHaveBeenCalledTimes(1);
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it('зогсоохыг хүсвэл бүрмөсөн зогсоно: socket-ыг хааж, дахин холбогдохгүй', async () => {
    const { stop } = setup();
    await flush();
    FakeSocket.instances[0].open();

    stop();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(FakeSocket.instances[0].closed).toBe(true);
    expect(FakeSocket.instances).toHaveLength(1);
  });
});
