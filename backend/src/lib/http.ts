import { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

export const json = (
  statusCode: number,
  body: unknown
): APIGatewayProxyStructuredResultV2 => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// Every error answers with the same shape. `code` is stable and meant for programs (the frontend
// picks the text shown to the user from it); `error` is an English explanation for developers.
export interface ApiErrorBody {
  code: string;
  error: string;
}

export const apiError = (statusCode: number, code: string, error: string) =>
  json(statusCode, { code, error } satisfies ApiErrorBody);
