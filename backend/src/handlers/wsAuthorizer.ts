import type { APIGatewayAuthorizerResult, APIGatewayRequestAuthorizerHandler } from 'aws-lambda';
import { CognitoJwtVerifier } from 'aws-jwt-verify';

// API Gateway's built-in JWT authorizer exists only for HTTP APIs. A WebSocket API needs a Lambda
// authorizer on $connect. Browsers cannot set headers on a WebSocket, so the ID token comes in
// the query string (?token=...). It is only ever sent over wss://.
const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.USER_POOL_ID ?? '',
  clientId: process.env.USER_POOL_CLIENT_ID ?? '',
  tokenUse: 'id',
});

const policy = (
  effect: 'Allow' | 'Deny',
  principalId: string,
  resource: string,
  userId?: string
): APIGatewayAuthorizerResult => ({
  principalId,
  policyDocument: {
    Version: '2012-10-17',
    Statement: [{ Action: 'execute-api:Invoke', Effect: effect, Resource: resource }],
  },
  ...(userId ? { context: { userId } } : {}),
});

export const handler: APIGatewayRequestAuthorizerHandler = async (event) => {
  const token = event.queryStringParameters?.token;
  if (!token) throw new Error('Unauthorized');

  try {
    // Checks signature, issuer, audience, token type and expiry.
    const { sub } = await verifier.verify(token);
    return policy('Allow', sub, event.methodArn, sub);
  } catch {
    // The exact message makes API Gateway answer 401.
    throw new Error('Unauthorized');
  }
};
