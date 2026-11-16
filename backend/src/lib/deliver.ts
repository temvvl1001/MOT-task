import { PermanentDeliveryError, TemporaryDeliveryError } from './errors';
import { Notification } from './types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// `flaky` хүлээн авагч энэ оролдлогод сэргэнэ.
export const FLAKY_RECOVERS_ON_ATTEMPT = 3;

// Симуляци хийсэн хүргэлт. `result` текст нь UI хэрэглэгчид үзүүлдэг тул монгол хэлээр.
// Хүлээн авагч үр дүнг тодорхойлдог тул бүх замыг демо хийж болно:
//   *fail*    байнгын алдаа  -> шууд FAILED
//   *flaky*   1-2-р оролдлогод түр зуурын алдаа, дараа нь амжилттай
//   *outage*  үргэлж түр зуурын алдаа -> оролдлого дуусмагц FAILED
//   бусад нь амжилттай
// Production-д суваг тус бүрээр (SES / SNS / FCM) илгээж, provider-ийн алдааг ангилна
// (4xx -> байнгын, 5xx / timeout / throttle -> түр зуурын).
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
