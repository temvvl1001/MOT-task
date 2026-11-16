import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { APIGatewayRequestAuthorizerEvent } from 'aws-lambda';

const verify = vi.hoisted(() => vi.fn());

vi.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: { create: () => ({ verify }) },
}));

import { handler } from './wsAuthorizer';

const METHOD_ARN = 'arn:aws:execute-api:ap-southeast-2:123456789012:abc123/dev/$connect';

const authorize = (token?: string) =>
  handler(
    {
      methodArn: METHOD_ARN,
      queryStringParameters: token === undefined ? null : { token },
    } as unknown as APIGatewayRequestAuthorizerEvent,
    {} as never,
    () => undefined
  );

beforeEach(() => {
  verify.mockReset();
});

describe('wsAuthorizer', () => {
  it('зөв токенийг зөвшөөрч, $connect-д хэрэглэгчийн id-г дамжуулна', async () => {
    verify.mockResolvedValueOnce({ sub: 'user-1' });

    const res = await authorize('good.jwt.token');

    expect(verify).toHaveBeenCalledWith('good.jwt.token');
    expect(res).toMatchObject({
      principalId: 'user-1',
      context: { userId: 'user-1' },
      policyDocument: {
        Statement: [{ Action: 'execute-api:Invoke', Effect: 'Allow', Resource: METHOD_ARN }],
      },
    });
  });

  it('токенгүй холболтыг татгалзана', async () => {
    await expect(authorize()).rejects.toThrow('Unauthorized');
    expect(verify).not.toHaveBeenCalled();
  });

  it('баталгаажаагүй токенийг татгалзана (буруу гарын үсэг, хугацаа дууссан, өөр pool)', async () => {
    verify.mockRejectedValueOnce(new Error('JwtExpiredError'));

    await expect(authorize('bad.jwt.token')).rejects.toThrow('Unauthorized');
  });

  it('баталгаажуулалт яагаад унасныг дотоод дэлгэрэнгүйгээр задруулахгүй', async () => {
    verify.mockRejectedValueOnce(new Error('secret internal detail'));

    await expect(authorize('x')).rejects.toThrow(/^Unauthorized$/);
  });
});
