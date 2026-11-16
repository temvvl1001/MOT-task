import { APIGatewayProxyHandlerV2WithJWTAuthorizer } from 'aws-lambda';
import { createHash, randomUUID } from 'crypto';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { userIdOf } from '../lib/auth';
import { ddb, sqs } from '../lib/clients';
import { RETENTION_SECONDS } from '../lib/config';
import { apiError, json } from '../lib/http';
import { Notification } from '../lib/types';
import { validateCreateInput } from '../lib/validate';

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,64}$/;

// Ижил хэрэглэгч, ижил түлхүүр үргэлж ижил id өгдөг тул хүсэлтээ дахин илгээсэн client
// (timeout, давхар дарсан, хариу алдагдсан) хоёр дахь notification үүсгэж чадахгүй.
const idFor = (userId: string, key: string) => {
  const h = createHash('sha256').update(`${userId}:${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
  const userId = userIdOf(event);
  if (!userId) return apiError(401, 'unauthorized', 'Unauthorized');

  const key = event.headers?.['idempotency-key'];
  if (key !== undefined && !IDEMPOTENCY_KEY.test(key)) {
    return apiError(
      400,
      'invalid_idempotency_key',
      'Idempotency-Key must be 8-64 characters: letters, digits, - or _'
    );
  }

  let body: any;
  try {
    body = JSON.parse(event.body ?? '');
  } catch {
    return apiError(400, 'invalid_json', 'Invalid JSON');
  }

  const error = validateCreateInput(body);
  if (error) return json(400, error);

  const now = new Date().toISOString();
  const notification: Notification = {
    id: key ? idFor(userId, key) : randomUUID(),
    userId,
    recipient: body.recipient.trim(),
    channel: body.channel,
    message: body.message.trim(),
    status: 'PENDING',
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    expiresAt: Math.floor(Date.now() / 1000) + RETENTION_SECONDS,
  };

  // 1-р алхам, commit point: мөр DynamoDB-д орсон бол хүсэлт найдвартай хадгалагдсан.
  try {
    await ddb.send(
      new PutCommand({
        TableName: process.env.NOTIFICATIONS_TABLE,
        Item: notification,
        ConditionExpression: 'attribute_not_exists(id)',
      })
    );
  } catch (err) {
    if (!(err instanceof ConditionalCheckFailedException)) throw err;
    // Өмнөх хүсэлттэй ижил Idempotency-Key: тэр notification-ийг буцаана, дахин дараалалд тавихгүй.
    const { Item } = await ddb.send(
      new GetCommand({ TableName: process.env.NOTIFICATIONS_TABLE, Key: { id: notification.id } })
    );
    // Түлхүүр нэг хүсэлтийг төлөөлөх ёстой. Ижил түлхүүр өөр агуулгатай байвал client-ийн алдаа бөгөөд
    // өөр хүсэлтийн notification-ээр чимээгүй хариулах ёсгүй.
    if (
      !Item ||
      Item.recipient !== notification.recipient ||
      Item.channel !== notification.channel ||
      Item.message !== notification.message
    ) {
      return apiError(
        409,
        'idempotency_key_reused',
        'This Idempotency-Key was already used with a different request'
      );
    }
    return json(200, Item);
  }

  // 2-р алхам: дараалалд тавина. Энэ нь тусдаа унаж болно (SQS-ийн доголдол, завсар Lambda зогссон). Мөр
  // PENDING хэвээр үлдэж, төлөвлөгдсөн requeueStale функц дараа нь дараалалд оруулах тул
  // хүсэлт хэзээ ч алдагдахгүй. 202 нь хүлээн авсан ч дараалалд хараахан ороогүйг client-д хэлнэ.
  try {
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: process.env.QUEUE_URL,
        MessageBody: JSON.stringify({ id: notification.id }),
      })
    );
  } catch (err) {
    console.error(`Could not enqueue ${notification.id}; requeueStale will retry`, err);
    return json(202, notification);
  }

  return json(201, notification);
};
