import { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../lib/clients';
import { json } from '../lib/http';
import { Notification } from '../lib/types';

export const handler: APIGatewayProxyHandlerV2 = async () => {
  const { Items = [] } = await ddb.send(
    new ScanCommand({ TableName: process.env.NOTIFICATIONS_TABLE })
  );

  const notifications = (Items as Notification[]).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );

  return json(200, notifications);
};