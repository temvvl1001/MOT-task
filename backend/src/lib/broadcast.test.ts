import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Notification } from './types';

const postSend = vi.hoisted(() => vi.fn());

vi.mock('@aws-sdk/client-apigatewaymanagementapi', () => ({
  ApiGatewayManagementApiClient: class {
    send = postSend;
  },
  PostToConnectionCommand: class {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
}));
vi.mock('./clients', () => ({ ddb: { send: vi.fn() } }));

import { ddb } from './clients';
import { broadcastNotification } from './broadcast';

const ddbSend = ddb.send as unknown as Mock;
const post = postSend as unknown as Mock;

const notification: Notification = {
  id: 'n1',
  recipient: 'bold@example.com',
  channel: 'EMAIL',
  message: 'Hello',
  status: 'COMPLETED',
  result: 'Delivered',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:01.000Z',
};

const connections = (...ids: string[]) =>
  ddbSend.mockResolvedValueOnce({ Items: ids.map((connectionId) => ({ connectionId })) });

const pushedTo = () => post.mock.calls.map(([command]) => command.input.ConnectionId);

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  process.env.CONNECTIONS_TABLE = 'connections-table';
});

describe('broadcastNotification', () => {
  it('pushes a NOTIFICATION_UPDATED message to every connection', async () => {
    connections('a', 'b');

    await broadcastNotification(notification);

    expect(pushedTo()).toEqual(['a', 'b']);
    for (const [command] of post.mock.calls) {
      expect(JSON.parse(command.input.Data)).toEqual({
        type: 'NOTIFICATION_UPDATED',
        notification,
      });
    }
  });

  it('does nothing when nobody is connected', async () => {
    connections();

    await broadcastNotification(notification);

    expect(post).not.toHaveBeenCalled();
  });

  it('removes a connection that is gone (GoneException)', async () => {
    connections('a', 'b');
    post.mockImplementation(async (command) => {
      if (command.input.ConnectionId === 'a') {
        throw Object.assign(new Error('gone'), { name: 'GoneException' });
      }
    });

    await broadcastNotification(notification);

    const deletes = ddbSend.mock.calls.slice(1).map(([command]) => command.input);
    expect(deletes).toEqual([{ TableName: 'connections-table', Key: { connectionId: 'a' } }]);
    expect(pushedTo()).toEqual(['a', 'b']);
  });

  it('removes a connection that answers HTTP 410', async () => {
    connections('a');
    post.mockRejectedValueOnce(Object.assign(new Error('gone'), { $metadata: { httpStatusCode: 410 } }));

    await broadcastNotification(notification);

    expect(ddbSend.mock.calls[1][0].input.Key).toEqual({ connectionId: 'a' });
  });

  it('keeps going and keeps the connection when a push fails for another reason', async () => {
    connections('a', 'b');
    post.mockImplementation(async (command) => {
      if (command.input.ConnectionId === 'a') throw new Error('throttled');
    });

    await expect(broadcastNotification(notification)).resolves.toBeUndefined();

    expect(pushedTo()).toEqual(['a', 'b']);
    expect(ddbSend).toHaveBeenCalledTimes(1);
  });
});
