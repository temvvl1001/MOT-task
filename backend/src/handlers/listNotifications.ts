import { APIGatewayProxyHandlerV2WithJWTAuthorizer } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { userIdOf } from '../lib/auth';
import { ddb } from '../lib/clients';
import { apiError, json } from '../lib/http';
import { decodeCursor, encodeCursor } from '../lib/pagination';
import { Notification, NotificationPage } from '../lib/types';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
  const userId = userIdOf(event);
  if (!userId) return apiError(401, 'unauthorized', 'Unauthorized');

  const rawLimit = event.queryStringParameters?.limit;
  const limit = rawLimit === undefined ? DEFAULT_LIMIT : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return apiError(400, 'invalid_limit', `limit must be an integer between 1 and ${MAX_LIMIT}`);
  }

  const token = event.queryStringParameters?.nextToken;
  const startKey = token ? decodeCursor(token, userId) : undefined;
  if (token && !startKey) return apiError(400, 'invalid_next_token', 'Invalid nextToken');

  // One Query against the byUser index: only this user's items, newest first, one page.
  const { Items = [], LastEvaluatedKey } = await ddb.send(
    new QueryCommand({
      TableName: process.env.NOTIFICATIONS_TABLE,
      IndexName: 'byUser',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: { ':userId': userId },
      ScanIndexForward: false,
      Limit: limit,
      ExclusiveStartKey: startKey ?? undefined,
    })
  );

  const page: NotificationPage = { items: Items as Notification[] };
  if (LastEvaluatedKey) {
    page.nextToken = encodeCursor({
      id: LastEvaluatedKey.id,
      userId: LastEvaluatedKey.userId,
      createdAt: LastEvaluatedKey.createdAt,
    });
  }
  return json(200, page);
};
