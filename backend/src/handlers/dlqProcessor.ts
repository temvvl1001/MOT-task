import { SQSHandler } from 'aws-lambda';
import { failUnfinished } from '../lib/notificationStore';
import { notify } from '../lib/notify';
import { parseId } from '../lib/queueMessage';

// Message нь зөвхөн worker өөрөө дуусгаж чадаагүй үед dead-letter queue-д орно
// (унасан, timeout болсон, эсвэл message уншигдахгүй). Энэ функцгүй бол
// notification үүрд PENDING эсвэл PROCESSING төлөвт гацна.
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
