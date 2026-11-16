import { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

export const json = (
  statusCode: number,
  body: unknown
): APIGatewayProxyStructuredResultV2 => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// Алдаа бүр ижил бүтцээр хариулна. `code` нь тогтвортой бөгөөд програмд зориулагдсан (frontend
// хэрэглэгчид харуулах текстийг үүгээр сонгоно); `error` нь хөгжүүлэгчид зориулсан англи тайлбар.
export interface ApiErrorBody {
  code: string;
  error: string;
}

export const apiError = (statusCode: number, code: string, error: string) =>
  json(statusCode, { code, error } satisfies ApiErrorBody);
