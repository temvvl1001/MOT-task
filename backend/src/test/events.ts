import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyHandlerV2WithJWTAuthorizer,
} from 'aws-lambda';

interface EventOptions {
  userId?: string;
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}

// JWT authorizer token-ийг зөвшөөрсний дараа API Gateway-ийн өгдөг хамгийн энгийн HTTP API event.
export const apiEvent = (options: EventOptions = {}) =>
  ({
    headers: options.headers ?? {},
    body:
      options.body === undefined
        ? undefined
        : typeof options.body === 'string'
          ? options.body
          : JSON.stringify(options.body),
    queryStringParameters: options.query,
    requestContext: {
      authorizer: options.userId
        ? { jwt: { claims: { sub: options.userId }, scopes: [] } }
        : undefined,
    },
  }) as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;

export const callApi = async (
  handler: APIGatewayProxyHandlerV2WithJWTAuthorizer,
  options: EventOptions = {}
) => {
  const res = (await handler(apiEvent(options), {} as never, () => undefined)) as {
    statusCode: number;
    body: string;
  };
  return { status: res.statusCode, body: JSON.parse(res.body) };
};
