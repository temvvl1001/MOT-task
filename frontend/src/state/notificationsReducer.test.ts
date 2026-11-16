import { describe, expect, it } from 'vitest';
import { countBy, initialState, reducer, sorted, type State } from './notificationsReducer';
import type { Notification } from '../types';

const n = (id: string, extra: Partial<Notification> = {}): Notification => ({
  id,
  recipient: `${id}@example.com`,
  channel: 'EMAIL',
  message: 'Hello',
  status: 'PENDING',
  attempts: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...extra,
});

const ids = (state: State) => sorted(state).map((item) => item.id);

describe('upsert (шууд шинэчлэлт)', () => {
  it('урьд нь байгаагүй notification-ийг нэмнэ', () => {
    const state = reducer(initialState, { type: 'upsert', notification: n('a') });

    expect(ids(state)).toEqual(['a']);
  });

  it('notification-ийн шинэ хувилбарыг хэрэглэнэ', () => {
    let state = reducer(initialState, { type: 'upsert', notification: n('a') });
    state = reducer(state, {
      type: 'upsert',
      notification: n('a', { status: 'COMPLETED', updatedAt: '2026-01-01T00:00:05.000Z' }),
    });

    expect(state.byId.a.status).toBe('COMPLETED');
  });

  it('хоцорч ирсэн хуучин хувилбарыг үл тооно (push нь POST-ийн хариунаас түрүүлсэн тохиолдол)', () => {
    let state = reducer(initialState, {
      type: 'upsert',
      notification: n('a', { status: 'COMPLETED', updatedAt: '2026-01-01T00:00:05.000Z' }),
    });
    state = reducer(state, { type: 'upsert', notification: n('a', { status: 'PENDING' }) });

    expect(state.byId.a.status).toBe('COMPLETED');
  });

  it('бусад notification-д хүрэхгүй', () => {
    let state = reducer(initialState, { type: 'upsert', notification: n('a') });
    state = reducer(state, { type: 'upsert', notification: n('b') });

    expect(ids(state).sort()).toEqual(['a', 'b']);
  });
});

describe('pagination (хуудаслалт)', () => {
  it('эхний хуудас cursor-ыг тавьж, жагсаалтыг ачаалсан гэж тэмдэглэнэ', () => {
    const state = reducer(initialState, {
      type: 'firstPage',
      items: [n('a')],
      nextToken: 'cursor-1',
    });

    expect(state.loaded).toBe(true);
    expect(state.nextToken).toBe('cursor-1');
  });

  it('эхний хуудсыг дахин татахад хэрэглэгчийн хүрсэн cursor хэвээр үлдэнэ', () => {
    let state = reducer(initialState, { type: 'firstPage', items: [n('a')], nextToken: 'cursor-1' });
    state = reducer(state, { type: 'nextPage', items: [n('b')], nextToken: 'cursor-2' });
    state = reducer(state, { type: 'firstPage', items: [n('a')], nextToken: 'cursor-1' });

    expect(state.nextToken).toBe('cursor-2');
  });

  it('сүүлийн хуудас cursor-ыг цэвэрлэнэ', () => {
    let state = reducer(initialState, { type: 'firstPage', items: [n('a')], nextToken: 'cursor-1' });
    state = reducer(state, { type: 'nextPage', items: [n('b')] });

    expect(state.nextToken).toBeUndefined();
  });

  it('салсны дараах дахин таталт алдсан зүйлийг нэмж, хуучин хуудсуудыг алдахгүй', () => {
    let state = reducer(initialState, { type: 'firstPage', items: [n('b')], nextToken: 'c' });
    state = reducer(state, {
      type: 'firstPage',
      items: [n('a', { createdAt: '2026-01-02T00:00:00.000Z' }), n('b')],
    });

    expect(ids(state)).toEqual(['a', 'b']);
  });

  it('хуудсууд давхцсан ч нэг notification-ийг хоёр удаа үзүүлэхгүй', () => {
    let state = reducer(initialState, { type: 'firstPage', items: [n('a'), n('b')] });
    state = reducer(state, { type: 'nextPage', items: [n('b'), n('c')] });

    expect(ids(state).sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('sorted ба countBy', () => {
  it('шинэ нь эхэнд жагсана', () => {
    let state = reducer(initialState, {
      type: 'firstPage',
      items: [
        n('old', { createdAt: '2026-01-01T00:00:00.000Z' }),
        n('new', { createdAt: '2026-01-03T00:00:00.000Z' }),
        n('mid', { createdAt: '2026-01-02T00:00:00.000Z' }),
      ],
    });
    state = { ...state };

    expect(ids(state)).toEqual(['new', 'mid', 'old']);
  });

  it('шүүлтүүрийн товчнуудад төлөв бүрийн тоог тооцно', () => {
    const items = [n('a'), n('b', { status: 'FAILED' }), n('c', { status: 'FAILED' })];

    expect(countBy(items, 'ALL')).toBe(3);
    expect(countBy(items, 'FAILED')).toBe(2);
    expect(countBy(items, 'COMPLETED')).toBe(0);
  });
});
