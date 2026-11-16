// Cursor for the `byUser` index: exactly the keys DynamoDB returns as LastEvaluatedKey.
export interface Cursor {
  id: string;
  userId: string;
  createdAt: string;
}

export const encodeCursor = (key: Cursor): string =>
  Buffer.from(JSON.stringify(key)).toString('base64url');

// The token comes from the client, so it is never trusted: it must decode to the expected
// shape and belong to the caller. Otherwise a user could start reading at someone else's items.
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
    // fall through
  }
  return null;
};
