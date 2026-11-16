import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import { ddb, sqs } from '../lib/clients';
import { STALE_PENDING_MS } from '../lib/config';

const MAX_PAGES = 10;

// The write to DynamoDB and the send to SQS cannot be one transaction. If the API Lambda dies
// (or SQS is down) in between, the item is saved but never queued. This scheduled function
// repairs that: it re-enqueues PENDING items nobody has touched for a while. Re-enqueueing is
// always safe because the worker's atomic claim ignores duplicates.
export const handler = async () => {
  const cutoff = new Date(Date.now() - STALE_PENDING_MS).toISOString();
  const ids: string[] = [];
  let startKey: Record<string, unknown> | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const { Items = [], LastEvaluatedKey } = await ddb.send(
      new QueryCommand({
        TableName: process.env.NOTIFICATIONS_TABLE,
        IndexName: 'byStatus',
        KeyConditionExpression: '#s = :pending AND updatedAt < :cutoff',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':pending': 'PENDING', ':cutoff': cutoff },
        Limit: 100,
        ExclusiveStartKey: startKey,
      })
    );
    ids.push(...Items.map((item) => item.id as string));
    startKey = LastEvaluatedKey;
    if (!startKey) break;
  }

  for (let i = 0; i < ids.length; i += 10) {
    const { Failed = [] } = await sqs.send(
      new SendMessageBatchCommand({
        QueueUrl: process.env.QUEUE_URL,
        Entries: ids.slice(i, i + 10).map((id, n) => ({
          Id: String(n),
          MessageBody: JSON.stringify({ id }),
        })),
      })
    );
    if (Failed.length > 0) console.error('Some messages could not be re-enqueued', Failed);
  }

  console.log(`Re-enqueued ${ids.length} stale PENDING notification(s)`);
  return { requeued: ids.length };
};
