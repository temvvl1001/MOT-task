import type { CreateNotificationInput } from './types';

// Нэг Idempotency-Key нь нэг хүсэлтийг төлөөлнө. Ижил агуулгыг дахин илгээхэд (timeout, давхар дарсан,
// хариу алдагдсаны дараа) түлхүүрийг дахин ашиглах ёстой, ингэснээр сервер нэг л notification үүсгэнэ.
// Өөр агуулга илгээхэд шинэ түлхүүр хэрэглэх ёстой, үгүй бол сервер түлхүүрийг буруу ашигласан гэж татгалзана.
export interface Attempt {
  key: string;
  content: string;
}

// Хоёр хүсэлтийг "ижил" болгодог зүйл: сервер хадгалдаг утгууд (мөн тэр тайрдаг).
export const contentOf = (input: CreateNotificationInput): string =>
  JSON.stringify({
    recipient: input.recipient.trim(),
    channel: input.channel,
    message: input.message.trim(),
  });

export const attemptFor = (
  current: Attempt,
  content: string,
  newKey: () => string = () => crypto.randomUUID()
): Attempt => (current.content === content ? current : { key: newKey(), content });
