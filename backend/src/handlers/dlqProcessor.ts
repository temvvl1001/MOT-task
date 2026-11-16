import { SQSHandler } from 'aws-lambda';
import { failUnfinished } from '../lib/notificationStore';
import { notify } from '../lib/notify';
import { parseId } from '../lib/queueMessage';

// Messages reach the dead-letter queue only when the worker itself could not finish them
// (it crashed, timed out, or the message was unreadable). Without this function the
// notification would stay PENDING or PROCESSING forever.
export const handler: SQSHandler = async (event) => {
  for (const record of event.Records) {
    const id = parseId(record.body);
    if (!id) {
      console.error(`Unreadable message ${record.messageId} in the dead-letter queue`);
      continue;
    }

    const failed = await failUnfinished(
      id,
      'Боловсруулалт удаа дараа амжилтгүй болж, алдааны дараалалд (DLQ) шилжсэн'
    );
    if (failed) await notify(failed);
  }
};
