import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from './pagination';

const key = { id: 'n1', userId: 'user-1', createdAt: '2026-01-01T00:00:00.000Z' };
const tokenOf = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('cursor', () => {
  it('эзэмшигчдээ кодлоод буцааж тайлагдана', () => {
    expect(decodeCursor(encodeCursor(key), 'user-1')).toEqual(key);
  });

  it('URL-д аюулгүй тэмдэгтүүдээс тогтоно', () => {
    expect(encodeCursor(key)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('өөр хэрэглэгчид тайлагдахгүй', () => {
    expect(decodeCursor(encodeCursor(key), 'user-2')).toBeNull();
  });

  it.each([
    ['base64 json биш', '%%%'],
    ['объект биш json', tokenOf('text')],
    ['id байхгүй', tokenOf({ userId: 'user-1', createdAt: 'x' })],
    ['createdAt байхгүй', tokenOf({ id: 'n1', userId: 'user-1' })],
    ['буруу төрлийн утга', tokenOf({ id: 1, userId: 'user-1', createdAt: 'x' })],
  ])('cursor-ыг татгалзана: %s', (_name, token) => {
    expect(decodeCursor(token, 'user-1')).toBeNull();
  });

  it('илүү талбаруудыг хаяна, ингэснээр client нэмэлт түлхүүр шургуулж чадахгүй', () => {
    const token = tokenOf({ ...key, extra: 'x' });

    expect(decodeCursor(token, 'user-1')).toEqual(key);
  });
});
