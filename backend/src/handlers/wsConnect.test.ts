import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { APIGatewayProxyWebsocketEventV2 } from 'aws-lambda';

vi.mock('../lib/clients', () => ({ ddb: { send: vi.fn() } }));

import { ddb } from '../lib/clients';
import { CONNECTION_TTL_SECONDS, handler } from './wsConnect';

const send = ddb.send as unknown as Mock;

const connect = (authorizer?: { userId?: string }) =>
  handler(
    { requestContext: { connectionId: 'abc', authorizer } } as unknown as APIGatewayProxyWebsocketEventV2,
    {} as never,
    () => undefined
  );

beforeEach(() => {
  vi.resetAllMocks();
  process.env.CONNECTIONS_TABLE = 'connections-table';
});

describe('wsConnect', () => {
  it('холболтыг эзэмшигчтэй нь хадгалж, WebSocket-ийн наслалтаас урт хугацаатай TTL тавина', async () => {
    const before = Math.floor(Date.now() / 1000);

    const res = await connect({ userId: 'user-1' });

    expect(res).toEqual({ statusCode: 200 });
    const { TableName, Item } = send.mock.calls[0][0].input;
    expect(TableName).toBe('connections-table');
    expect(Item).toMatchObject({ connectionId: 'abc', userId: 'user-1' });
    expect(Item.expiresAt).toBeGreaterThanOrEqual(before + CONNECTION_TTL_SECONDS);
    // API Gateway холболтыг 2 цагаас илүү нээлттэй байлгадаггүй
    expect(CONNECTION_TTL_SECONDS).toBeGreaterThan(2 * 60 * 60);
  });

  it('authorizer-ийн баталгаажуулаагүй холболтыг татгалзана', async () => {
    const res = await connect(undefined);

    expect(res).toEqual({ statusCode: 401 });
    expect(send).not.toHaveBeenCalled();
  });
});
