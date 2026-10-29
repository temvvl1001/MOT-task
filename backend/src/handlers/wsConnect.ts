import { APIGatewayProxyWebsocketHandlerV2 } from 'aws-lambda';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../lib/clients';

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  await ddb.send(
    new PutCommand({
      TableName: process.env.CONNECTIONS_TABLE,
      Item: {
        connectionId: event.requestContext.connectionId,
        connectedAt: new Date().toISOString(),
      },
    })
  );
  return { statusCode: 200 };
};