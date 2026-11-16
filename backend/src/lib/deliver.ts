import { PermanentDeliveryError, TemporaryDeliveryError } from './errors';
import { Notification } from './types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The `flaky` recipient recovers on this attempt.
export const FLAKY_RECOVERS_ON_ATTEMPT = 3;

// Simulated delivery. The `result` texts are Mongolian because the UI shows them to the user.
// The recipient decides the outcome so every path can be demonstrated:
//   *fail*    permanent failure  -> FAILED at once
//   *flaky*   temporary failure on attempts 1-2, then succeeds
//   *outage*  temporary failure every time -> FAILED once the attempts run out
//   anything else succeeds
// In production this would dispatch per channel (SES / SNS / FCM) and map provider errors
// (4xx -> permanent, 5xx / timeouts / throttling -> temporary).
export const deliver = async (n: Notification, attempt: number): Promise<string> => {
  await sleep(1000 + Math.random() * 2000);
  const recipient = n.recipient.toLowerCase();

  if (recipient.includes('fail')) {
    throw new PermanentDeliveryError(`${n.recipient} хаяг руу илгээх хүсэлт татгалзагдлаа`);
  }
  if (recipient.includes('outage')) {
    throw new TemporaryDeliveryError('Үйлчилгээ түр хугацаанд боломжгүй байна');
  }
  if (recipient.includes('flaky') && attempt < FLAKY_RECOVERS_ON_ATTEMPT) {
    throw new TemporaryDeliveryError('Үйлчилгээ түр хугацаанд тасалдсан');
  }
  return `${n.channel} сувгаар ${n.recipient} хаяг руу амжилттай хүргэлээ`;
};
