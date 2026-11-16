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
  userId: 'user-1',
  recipient: 'bold@example.com',
  channel: 'EMAIL',
  message: 'Hello',
  status: 'COMPLETED',
  result: 'Хүргэгдлээ',
  attempts: 1,
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
  it('эзэмшигчийн холболтуудыг byUser индексээр л хайна', async () => {
    connections();

    await broadcastNotification(notification);

    expect(ddbSend.mock.calls[0][0].input).toMatchObject({
      TableName: 'connections-table',
      IndexName: 'byUser',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: { ':userId': 'user-1' },
    });
  });

  it('тэдгээр холболт бүрт NOTIFICATION_UPDATED message илгээнэ', async () => {
    connections('a', 'b');

    await broadcastNotification(notification);

    expect(pushedTo()).toEqual(['a', 'b']);
    for (const [command] of post.mock.calls) {
      expect(JSON.parse(command.input.Data)).toEqual({ type: 'NOTIFICATION_UPDATED', notification });
    }
  });

  it('холболтуудын бүх хуудсыг уншина', async () => {
    ddbSend
      .mockResolvedValueOnce({ Items: [{ connectionId: 'a' }], LastEvaluatedKey: { connectionId: 'a' } })
      .mockResolvedValueOnce({ Items: [{ connectionId: 'b' }] });

    await broadcastNotification(notification);

    expect(ddbSend.mock.calls[1][0].input.ExclusiveStartKey).toEqual({ connectionId: 'a' });
    expect(pushedTo()).toEqual(['a', 'b']);
  });

  it('эзэмшигчид нээлттэй холболт байхгүй бол юу ч хийхгүй', async () => {
    connections();

    await broadcastNotification(notification);

    expect(post).not.toHaveBeenCalled();
  });

  it('салсан холболтыг (GoneException) устгана', async () => {
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

  it('HTTP 410 хариулсан холболтыг устгана', async () => {
    connections('a');
    post.mockRejectedValueOnce(Object.assign(new Error('gone'), { $metadata: { httpStatusCode: 410 } }));

    await broadcastNotification(notification);

    expect(ddbSend.mock.calls[1][0].input.Key).toEqual({ connectionId: 'a' });
  });

  it('өөр шалтгаанаар push унавал үлдсэнийг үргэлжлүүлж, холболтыг устгахгүй', async () => {
    connections('a', 'b');
    post.mockImplementation(async (command) => {
      if (command.input.ConnectionId === 'a') throw new Error('throttled');
    });

    await expect(broadcastNotification(notification)).resolves.toBeUndefined();

    expect(pushedTo()).toEqual(['a', 'b']);
    expect(ddbSend).toHaveBeenCalledTimes(1);
  });
});
