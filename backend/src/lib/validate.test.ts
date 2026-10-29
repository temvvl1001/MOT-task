import { describe, expect, it } from 'vitest';
import { MAX_MESSAGE_LENGTH, validateCreateInput } from './validate';

const valid = { recipient: 'bold@example.com', channel: 'EMAIL', message: 'Hello' };

describe('validateCreateInput', () => {
  it('accepts a valid body', () => {
    expect(validateCreateInput(valid)).toBeNull();
  });

  it.each(['EMAIL', 'SMS', 'PUSH'])('accepts channel %s', (channel) => {
    expect(validateCreateInput({ ...valid, channel })).toBeNull();
  });

  it.each([null, undefined, 'text', 42])('rejects a non-object body (%s)', (body) => {
    expect(validateCreateInput(body)).toBe('Request body must be a JSON object');
  });

  it.each(['', '   ', undefined, 123])('rejects an invalid recipient (%j)', (recipient) => {
    expect(validateCreateInput({ ...valid, recipient })).toBe('recipient is required');
  });

  it.each(['FAX', 'email', '', undefined])('rejects an invalid channel (%j)', (channel) => {
    expect(validateCreateInput({ ...valid, channel })).toMatch(/channel must be one of/);
  });

  it.each(['', '   ', undefined, 123])('rejects an invalid message (%j)', (message) => {
    expect(validateCreateInput({ ...valid, message })).toBe('message is required');
  });

  it('accepts a message of exactly the maximum length', () => {
    const message = 'a'.repeat(MAX_MESSAGE_LENGTH);
    expect(validateCreateInput({ ...valid, message })).toBeNull();
  });

  it('rejects a message over the maximum length', () => {
    const message = 'a'.repeat(MAX_MESSAGE_LENGTH + 1);
    expect(validateCreateInput({ ...valid, message })).toMatch(/characters or less/);
  });
});