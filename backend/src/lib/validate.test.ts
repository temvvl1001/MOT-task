import { describe, expect, it } from 'vitest';
import { MAX_MESSAGE_LENGTH, validateCreateInput } from './validate';

const valid = { recipient: 'bold@example.com', channel: 'EMAIL', message: 'Hello' };

describe('validateCreateInput: хүсэлтийн шалгалт', () => {
  it('зөв хүсэлтийг хүлээн авна', () => {
    expect(validateCreateInput(valid)).toBeNull();
  });

  it.each(['EMAIL', 'SMS', 'PUSH'])('%s сувгийг хүлээн авна', (channel) => {
    expect(validateCreateInput({ ...valid, channel })).toBeNull();
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

  it('эхний олдсон алдааг л буцаана', () => {
    expect(validateCreateInput({ recipient: '', channel: 'FAX', message: '' })).toMatchObject({
      code: 'recipient_required',
    });
  });
});
