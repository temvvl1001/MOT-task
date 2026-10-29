import { APIGatewayProxyWebsocketHandlerV2 } from 'aws-lambda';
import { DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../lib/clients';

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  await ddb.send(
    new DeleteCommand({
      TableName: process.env.CONNECTIONS_TABLE,
      Key: { connectionId: event.requestContext.connectionId },
    })
  );
  return { statusCode: 200 };
};