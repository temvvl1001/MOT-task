import type { APIGatewayAuthorizerResult, APIGatewayRequestAuthorizerHandler } from 'aws-lambda';
import { CognitoJwtVerifier } from 'aws-jwt-verify';

// API Gateway-ийн суурилсан JWT authorizer нь зөвхөн HTTP API-д бий. WebSocket API-д $connect дээр
// Lambda authorizer хэрэгтэй. Browser WebSocket-д header тавьж чаддаггүй тул ID token нь
// query string-ээр (?token=...) ирнэ. Үүнийг зөвхөн wss:// дээр илгээнэ.
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
    // Гарын үсэг, issuer, audience, token-ий төрөл, хугацааг шалгана.
    const { sub } = await verifier.verify(token);
    return policy('Allow', sub, event.methodArn, sub);
  } catch {
    // Яг энэ мессеж нь API Gateway-г 401 хариулахад хүргэнэ.
    throw new Error('Unauthorized');
  }
};
