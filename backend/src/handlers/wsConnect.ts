import { APIGatewayProxyWebsocketHandlerV2 } from 'aws-lambda';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../lib/clients';

// API Gateway closes every WebSocket after 2 hours at the latest. The extra hour
// guarantees the TTL only removes rows whose connection is certainly gone.
export const CONNECTION_TTL_SECONDS = 3 * 60 * 60;

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  // Set by the wsAuthorizer Lambda after it verified the token; API Gateway never lets an
  // unauthorized request reach this point.
  const { authorizer } = event.requestContext as unknown as {
    authorizer?: { userId?: string };
  };
  const userId = authorizer?.userId;
  if (!userId) return { statusCode: 401 };

  const now = new Date();
  await ddb.send(
    new PutCommand({
      TableName: process.env.CONNECTIONS_TABLE,
      Item: {
        connectionId: event.requestContext.connectionId,
        userId,
        connectedAt: now.toISOString(),
        expiresAt: Math.floor(now.getTime() / 1000) + CONNECTION_TTL_SECONDS,
      },
    })
  );
  return { statusCode: 200 };
};
