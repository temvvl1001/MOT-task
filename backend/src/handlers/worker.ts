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

// Message-ийг урт анхдагч visibility timeout-ийг хүлээлгүй, backoff-ын дараа дахин хүргэхийг SQS-ээс хүснэ.
// Энэ амжилтгүй болбол анхдагч timeout үйлчилнэ, тиймээс хамгийн сайн хүчин чармайлтаар хийгдэнэ.
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
    // Хэн ч боловсруулж чадахгүй. SQS дахин оролдож, эцэст нь DLQ-д хадгална.
    console.error(`Unreadable message ${record.messageId}`);
    return 'retry';
  }

  // Атомик PENDING -> PROCESSING. Байхгүй, дууссан, эсвэл боловсруулагдаж буй мөрийг алгасах нь
  // давхар хүргэлтийг хор хөнөөлгүй болгодог.
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

    // Байнгын: дахин оролдсон ч нэмэргүй.
    if (err instanceof PermanentDeliveryError) {
      const failed = await finish(id, 'FAILED', reason);
      if (failed) await notify(failed);
      return 'done';
    }

    // Түр зуурын (эсвэл гэнэтийн): оролдлого дуусвал FAILED, үгүй бол дараа нь дахин оролдоно.
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

// Partial batch response: зөвхөн дахин оролдох record-ууд дараалалд буцах тул нэг
// алдаатай record batch-ийн бусдыг дахин хүргүүлэхгүй.
export const handler: SQSHandler = async (event): Promise<SQSBatchResponse> => {
  const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];

  for (const record of event.Records) {
    try {
      if ((await processRecord(record)) === 'retry') {
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    } catch (err) {
      // Дэд бүтцийн алдаа (DynamoDB throttle, сүлжээ ...): backoff-той дахин оролдоно.
      console.error(`Processing ${record.messageId} failed`, err);
      await scheduleRetry(record, receiveCount(record));
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};
