import { describe, expect, it } from 'vitest';
import { attemptFor, contentOf, type Attempt } from './idempotency';

const input = { recipient: 'bold@example.com', channel: 'EMAIL' as const, message: 'Hello' };
const keys = () => {
  let n = 0;
  return () => `key-${++n}`;
};

describe('contentOf', () => {
  it('хоосон зайг тооцохгүй, сервер хадгалдагтай ижилхэн харьцуулна', () => {
    expect(contentOf({ ...input, recipient: '  bold@example.com ', message: ' Hello ' })).toBe(
      contentOf(input)
    );
  });

  it('утга өөр бол өөр агуулга гэж үзнэ', () => {
    expect(contentOf({ ...input, message: 'Bye' })).not.toBe(contentOf(input));
    expect(contentOf({ ...input, channel: 'SMS' })).not.toBe(contentOf(input));
  });
});

describe('attemptFor', () => {
  it('анхны хүсэлтэд шинэ түлхүүр үүсгэнэ', () => {
    const fresh: Attempt = { key: 'initial', content: '' };

    expect(attemptFor(fresh, contentOf(input), keys())).toEqual({
      key: 'key-1',
      content: contentOf(input),
    });
  });

  it('ижил агуулгыг дахин илгээхэд (дахин оролдлого) ижил түлхүүрийг ашиглана', () => {
    const newKey = keys();
    const first = attemptFor({ key: 'initial', content: '' }, contentOf(input), newKey);

    const again = attemptFor(first, contentOf(input), newKey);

    expect(again.key).toBe(first.key);
  });

  it('агуулгыг засвал шинэ түлхүүр авна, үгүй бол сервер 409 өгнө', () => {
    const newKey = keys();
    const first = attemptFor({ key: 'initial', content: '' }, contentOf(input), newKey);

    const edited = attemptFor(first, contentOf({ ...input, message: 'Засав' }), newKey);

    expect(edited.key).not.toBe(first.key);
  });
});
