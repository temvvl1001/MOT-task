import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { APIGatewayProxyWebsocketEventV2 } from 'aws-lambda';

vi.mock('../lib/clients', () => ({ ddb: { send: vi.fn() } }));

import { ddb } from '../lib/clients';
import { CONNECTION_TTL_SECONDS, handler } from './wsConnect';

const send = ddb.send as unknown as Mock;

beforeEach(() => {
  vi.resetAllMocks();
  process.env.CONNECTIONS_TABLE = 'connections-table';
});

describe('wsConnect', () => {
  it('stores the connection id with an expiry longer than the WebSocket lifetime', async () => {
    const before = Math.floor(Date.now() / 1000);
    const event = { requestContext: { connectionId: 'abc' } } as APIGatewayProxyWebsocketEventV2;

    const res = await handler(event, {} as never, () => undefined);

    expect(res).toEqual({ statusCode: 200 });
    const { TableName, Item } = send.mock.calls[0][0].input;
    expect(TableName).toBe('connections-table');
    expect(Item.connectionId).toBe('abc');
    expect(Item.expiresAt).toBeGreaterThanOrEqual(before + CONNECTION_TTL_SECONDS);
    // API Gateway never keeps a connection open longer than 2 hours
    expect(CONNECTION_TTL_SECONDS).toBeGreaterThan(2 * 60 * 60);
  });
});
