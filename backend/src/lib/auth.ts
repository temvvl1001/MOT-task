import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

// API Gateway has already verified the Cognito JWT (signature, issuer, audience, expiry).
// `sub` is the stable user id every item is scoped to.
export const userIdOf = (event: APIGatewayProxyEventV2WithJWTAuthorizer): string | undefined => {
  const sub = event.requestContext.authorizer?.jwt?.claims?.sub;
  return typeof sub === 'string' && sub ? sub : undefined;
};
