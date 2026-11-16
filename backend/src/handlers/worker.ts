import { SQSBatchResponse, SQSHandler, SQSRecord } from 'aws-lambda';
import { ChangeMessageVisibilityCommand } from '@aws-sdk/client-sqs';
import { sqs } from '../lib/clients';
import { MAX_ATTEMPTS, retryDelaySeconds } from '../lib/config';
import { deliver } from '../lib/deliver';
import { PermanentDeliveryError } from '../lib/errors';
import { claim, finish, release } from '../lib/notificationStore';
import { notify } from '../lib/notify';
import { parseId } from '../lib/queueMessage';

type Outcome = 'done' | 'retry';

const receiveCount = (record: SQSRecord) =>
  Number(record.attributes?.ApproximateReceiveCount ?? '1');

// Ask SQS to redeliver the message after a backoff instead of waiting out the long default
// visibility timeout. If this fails the default timeout still applies, so it is best effort.
const scheduleRetry = async (record: SQSRecord, attempt: number) => {
  try {
    await sqs.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: process.env.QUEUE_URL,
        ReceiptHandle: record.receiptHandle,
        VisibilityTimeout: retryDelaySeconds(attempt),
      })
    );
  } catch (err) {
    console.error('Could not shorten the visibility timeout', err);
  }
};

const processRecord = async (record: SQSRecord): Promise<Outcome> => {
  const attempt = receiveCount(record);
  const id = parseId(record.body);
  if (!id) {
    // Cannot be processed by anyone. Let SQS retry and finally park it in the DLQ.
    console.error(`Unreadable message ${record.messageId}`);
    return 'retry';
  }

  // Atomic PENDING -> PROCESSING. Missing, finished or in-flight items are skipped, which is
  // what makes duplicate deliveries harmless.
  const claimed = await claim(id, attempt);
  if (!claimed) {
    console.log(`Notification ${id} is missing, finished or in progress, skipping`);
    return 'done';
  }
  await notify(claimed);

  let result: string;
  try {
    result = await deliver(claimed, attempt);
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Unknown error';

    // Permanent: retrying cannot help.
    if (err instanceof PermanentDeliveryError) {
      const failed = await finish(id, 'FAILED', reason);
      if (failed) await notify(failed);
      return 'done';
    }

    // Temporary (or unexpected): out of attempts means FAILED, otherwise try again later.
    if (attempt >= MAX_ATTEMPTS) {
      const failed = await finish(id, 'FAILED', `${attempt} оролдлогын дараа бууж өгөв: ${reason}`);
      if (failed) await notify(failed);
      return 'done';
    }
    const released = await release(
      id,
      `${attempt}/${MAX_ATTEMPTS}-р оролдлого амжилтгүй: ${reason}. Дахин оролдоно.`
    );
    if (released) await notify(released);
    await scheduleRetry(record, attempt);
    return 'retry';
  }

  const completed = await finish(id, 'COMPLETED', result);
  if (completed) await notify(completed);
  return 'done';
};

// Partial batch response: only the records that need another try go back to the queue, so one
// failing record never causes the others in the batch to be delivered again.
export const handler: SQSHandler = async (event): Promise<SQSBatchResponse> => {
  const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];

  for (const record of event.Records) {
    try {
      if ((await processRecord(record)) === 'retry') {
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    } catch (err) {
      // Infrastructure error (DynamoDB throttling, network ...): retry with backoff.
      console.error(`Processing ${record.messageId} failed`, err);
      await scheduleRetry(record, receiveCount(record));
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};
