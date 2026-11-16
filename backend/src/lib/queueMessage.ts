// Дараалал зөвхөн notification-ийн id-г зөөнө; үнэний цорын ганц эх сурвалж нь DynamoDB.
export const parseId = (body: string): string | null => {
  try {
    const { id } = JSON.parse(body);
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
};
