import type { PreSignUpTriggerHandler } from 'aws-lambda';

// Demo-н хялбарчлал: шинэ хэрэглэгчийг тэр дор нь баталгаажуулж, имэйлээр дамжих шаардлагагүй болгоно.
// Production-д энэ trigger-ийг авч, Cognito-оор баталгаажуулах код илгээлгэнэ.
export const handler: PreSignUpTriggerHandler = async (event) => {
  event.response.autoConfirmUser = true;
  if (event.request.userAttributes.email) event.response.autoVerifyEmail = true;
  return event;
};
