// `byUser` индексийн cursor: DynamoDB-ийн LastEvaluatedKey-ээр буцаадаг түлхүүрүүд яг тэр хэвээрээ.
export interface Cursor {
  id: string;
  userId: string;
  createdAt: string;
}

export const encodeCursor = (key: Cursor): string =>
  Buffer.from(JSON.stringify(key)).toString('base64url');

// Token нь client-ээс ирдэг тул хэзээ ч итгэхгүй: хүлээгдэж буй бүтэцтэй тайлагдаж,
// дуудагчийнх байх ёстой. Үгүй бол хэрэглэгч бусдын мөрөөс унших боломжтой болно.
export const decodeCursor = (token: string, userId: string): Cursor | null => {
  try {
    const key = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    if (
      typeof key?.id === 'string' &&
      typeof key?.createdAt === 'string' &&
      key?.userId === userId
    ) {
      return { id: key.id, userId: key.userId, createdAt: key.createdAt };
    }
  } catch {
    // дараагийн алхам руу орно
  }
  return null;
};
