import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from './clients';
import { Notification } from './types';

const wsClient = new ApiGatewayManagementApiClient({
  endpoint: process.env.WS_ENDPOINT,
});

// All open connections of one user, read from the byUser index (not a table scan).
const connectionIdsOf = async (userId: string): Promise<string[]> => {
  const ids: string[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const { Items = [], LastEvaluatedKey } = await ddb.send(
      new QueryCommand({
        TableName: process.env.CONNECTIONS_TABLE,
        IndexName: 'byUser',
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: { ':userId': userId },
        ExclusiveStartKey: startKey,
      })
    );
    ids.push(...Items.map((item) => item.connectionId as string));
    startKey = LastEvaluatedKey;
  } while (startKey);
  return ids;
};

// Push the change to the owner's open tabs only; nobody else ever sees it.
export const broadcastNotification = async (notification: Notification) => {
  const connectionIds = await connectionIdsOf(notification.userId);
  const data = JSON.stringify({ type: 'NOTIFICATION_UPDATED', notification });

  await Promise.allSettled(
    connectionIds.map(async (connectionId) => {
      try {
        await wsClient.send(new PostToConnectionCommand({ ConnectionId: connectionId, Data: data }));
      } catch (err: any) {
        if (err.name === 'GoneException' || err.$metadata?.httpStatusCode === 410) {
          // The client left without a clean $disconnect: forget the connection.
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
