import { APIGatewayProxyWebsocketHandlerV2 } from 'aws-lambda';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../lib/clients';

// API Gateway WebSocket бүрийг дээд тал нь 2 цагийн дараа хаадаг. Нэмэлт нэг цаг нь
// TTL зөвхөн холболт нь үнэхээр дууссан мөрийг л устгахыг баталгаажуулна.
export const CONNECTION_TTL_SECONDS = 3 * 60 * 60;

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  // Token-ийг шалгасны дараа wsAuthorizer Lambda тавина; API Gateway зөвшөөрөлгүй хүсэлтийг
  // энд хүртэл хэзээ ч оруулдаггүй.
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
