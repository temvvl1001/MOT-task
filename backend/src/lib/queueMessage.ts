// The queue carries only the notification id; DynamoDB stays the single source of truth.
export const parseId = (body: string): string | null => {
  try {
    const { id } = JSON.parse(body);
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
};
