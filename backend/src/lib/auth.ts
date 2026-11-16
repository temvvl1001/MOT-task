import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

// API Gateway Cognito JWT-ийг (гарын үсэг, issuer, audience, хугацаа) аль хэдийн шалгасан.
// `sub` нь мөр бүрийг холбодог тогтвортой хэрэглэгчийн id.
export const userIdOf = (event: APIGatewayProxyEventV2WithJWTAuthorizer): string | undefined => {
  const sub = event.requestContext.authorizer?.jwt?.claims?.sub;
  return typeof sub === 'string' && sub ? sub : undefined;
};
