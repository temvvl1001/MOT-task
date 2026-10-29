import {
    ApiGatewayManagementApiClient,
    PostToConnectionCommand,
  } from '@aws-sdk/client-apigatewaymanagementapi';
  import { DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
  import { ddb } from './clients';
  import { Notification } from './types';
  
  const wsClient = new ApiGatewayManagementApiClient({
    endpoint: process.env.WS_ENDPOINT,
  });
  
  export const broadcastNotification = async (notification: Notification) => {
    const { Items = [] } = await ddb.send(
      new ScanCommand({ TableName: process.env.CONNECTIONS_TABLE })
    );
  
    const data = JSON.stringify({ type: 'NOTIFICATION_UPDATED', notification });
  
    await Promise.allSettled(
      Items.map(async ({ connectionId }) => {
        try {
          await wsClient.send(
            new PostToConnectionCommand({ ConnectionId: connectionId, Data: data })
          );
        } catch (err: any) {
          if (err.name === 'GoneException' || err.$metadata?.httpStatusCode === 410) {
            await ddb.send(
              new DeleteCommand({
                TableName: process.env.CONNECTIONS_TABLE,
                Key: { connectionId },
              })
            );
          } else {
            console.error(`Failed to push to ${connectionId}`, err);
          }
        }
      })
    );
  };