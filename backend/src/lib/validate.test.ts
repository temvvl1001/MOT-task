import { describe, expect, it } from 'vitest';
import { MAX_MESSAGE_LENGTH, validateCreateInput } from './validate';

const valid = { recipient: 'bold@example.com', channel: 'EMAIL', message: 'Hello' };

describe('validateCreateInput: хүсэлтийн шалгалт', () => {
  it('зөв хүсэлтийг хүлээн авна', () => {
    expect(validateCreateInput(valid)).toBeNull();
  });

  it.each([
    ['EMAIL', 'bold@gmail.com'],
    ['SMS', '+97699112233'],
    ['PUSH', 'device-token-123'],
  ])('%s сувгийг тохирох хүлээн авагчтай хүлээн авна', (channel, recipient) => {
    expect(validateCreateInput({ ...valid, channel, recipient })).toBeNull();
  });

  it.each([null, undefined, 'text', 42])('объект биш body-г татгалзана (%s)', (body) => {
    expect(validateCreateInput(body)).toEqual({
      code: 'invalid_body',
      error: 'Request body must be a JSON object',
    });
  });

  it.each(['', '   ', undefined, 123])('буруу recipient-г татгалзана (%j)', (recipient) => {
    expect(validateCreateInput({ ...valid, recipient })).toEqual({
      code: 'recipient_required',
      error: 'recipient is required',
    });
  });

  it.each(['FAX', 'email', '', undefined])('буруу channel-г татгалзана (%j)', (channel) => {
    expect(validateCreateInput({ ...valid, channel })).toMatchObject({ code: 'invalid_channel' });
  });

  it.each(['', '   ', undefined, 123])('буруу message-г татгалзана (%j)', (message) => {
    expect(validateCreateInput({ ...valid, message })).toEqual({
      code: 'message_required',
      error: 'message is required',
    });
  });

  it('яг дээд урттай message-г хүлээн авна', () => {
    const message = 'a'.repeat(MAX_MESSAGE_LENGTH);
    expect(validateCreateInput({ ...valid, message })).toBeNull();
  });

  it('дээд уртаас нэг тэмдэгт урт message-г татгалзана', () => {
    const message = 'a'.repeat(MAX_MESSAGE_LENGTH + 1);
    expect(validateCreateInput({ ...valid, message })).toMatchObject({ code: 'message_too_long' });
  });

  describe('хүлээн авагчийн хэлбэр (суваг тус бүрээр)', () => {
    const email = (recipient: string) => validateCreateInput({ ...valid, channel: 'EMAIL', recipient });
    const sms = (recipient: string) => validateCreateInput({ ...valid, channel: 'SMS', recipient });
    const push = (recipient: string) => validateCreateInput({ ...valid, channel: 'PUSH', recipient });

    it.each(['bold@gmail.com', 'a.b+tag@mail.example.co', '  bold@gmail.com  ', 'fail@example.com'])(
      'имэйл: %j зөв',
      (recipient) => {
        expect(email(recipient)).toBeNull();
      }
    );

    it.each(['asdf', 'bold', 'bold@', '@gmail.com', 'bold@gmail', 'bold @gmail.com', 'a@@b.com', 'bold@gmail..', 'bold@.com', 'bold@gmail.'])(
      'имэйл: %j буруу',
      (recipient) => {
        expect(email(recipient)).toMatchObject({ code: 'invalid_recipient_email' });
      }
    );

    it('имэйл: 254 тэмдэгтээс урт хаягийг татгалзана', () => {
      expect(email(`${'a'.repeat(250)}@b.co`)).toMatchObject({ code: 'invalid_recipient_email' });
    });

    it.each(['+97699112233', '99112233', '+976 9911 2233', '976-9911-2233'])('SMS: %j зөв', (recipient) => {
      expect(sms(recipient)).toBeNull();
    });

    it.each(['bold@gmail.com', '1234567', '12345678901234567', '99a12233', '+'])(
      'SMS: %j буруу',
      (recipient) => {
        expect(sms(recipient)).toMatchObject({ code: 'invalid_recipient_phone' });
      }
    );

    it.each(['abc', 'device-token-123', 'user@example.com'])('PUSH: %j зөв', (recipient) => {
      expect(push(recipient)).toBeNull();
    });

    it.each(['ab', 'has space', 'x'.repeat(129)])('PUSH: %j буруу', (recipient) => {
      expect(push(recipient)).toMatchObject({ code: 'invalid_recipient_device' });
    });

    it('сувгаа буруу сонгосон бол эхлээд суваг тухай алдаа өгнө', () => {
      expect(validateCreateInput({ ...valid, channel: 'FAX', recipient: 'asdf' })).toMatchObject({
        code: 'invalid_channel',
      });
    });
  });

  it('эхний олдсон алдааг л буцаана', () => {
    expect(validateCreateInput({ recipient: '', channel: 'FAX', message: '' })).toMatchObject({
      code: 'recipient_required',
    });
  });
});
