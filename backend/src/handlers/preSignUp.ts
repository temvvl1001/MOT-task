import type { PreSignUpTriggerHandler } from 'aws-lambda';

// Demo convenience: confirm every new user immediately so the app works without an email round
// trip. In production remove this trigger and let Cognito send a verification code instead.
export const handler: PreSignUpTriggerHandler = async (event) => {
  event.response.autoConfirmUser = true;
  if (event.request.userAttributes.email) event.response.autoVerifyEmail = true;
  return event;
};
