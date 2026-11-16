// Хүргэлтийн алдаа хоёр төрөлтэй бөгөөд worker тэдгээрийг өөрөөр боловсруулна.

// Дахин оролдсон ч нэмэргүй (хаяг буруу, хүлээн авагч татгалзсан).
// Notification шууд FAILED болно.
export class PermanentDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentDeliveryError';
  }
}

// Дахин оролдвол тус болж магадгүй (provider унасан, throttle, timeout).
// Notification PENDING руу буцаж, SQS backoff-ын дараа дахин хүргэнэ.
export class TemporaryDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemporaryDeliveryError';
  }
}
