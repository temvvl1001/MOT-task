import { describe, expect, it } from 'vitest';
import type { PreSignUpTriggerEvent } from 'aws-lambda';
import { handler } from './preSignUp';

const signUp = (userAttributes: Record<string, string>) =>
  handler(
    {
      request: { userAttributes },
      response: { autoConfirmUser: false, autoVerifyEmail: false, autoVerifyPhone: false },
    } as unknown as PreSignUpTriggerEvent,
    {} as never,
    () => undefined
  ) as Promise<PreSignUpTriggerEvent>;

describe('preSignUp', () => {
  it('хэрэглэгч болон имэйлийг тэр дор баталгаажуулна', async () => {
    const event = await signUp({ email: 'bold@example.com' });

    expect(event.response.autoConfirmUser).toBe(true);
    expect(event.response.autoVerifyEmail).toBe(true);
  });

  it('өгөөгүй имэйлийг баталгаажуулсан гэж үзэхгүй', async () => {
    const event = await signUp({});

    expect(event.response.autoConfirmUser).toBe(true);
    expect(event.response.autoVerifyEmail).toBe(false);
  });
});
