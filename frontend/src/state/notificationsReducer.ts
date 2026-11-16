import type { Notification, NotificationStatus } from '../types';

export interface State {
  byId: Record<string, Notification>;
  // Cursor for the next (older) page, absent on the last page.
  nextToken?: string;
  loaded: boolean;
}

export type Action =
  // The newest page: the first load, or a refetch after the WebSocket reconnected.
  | { type: 'firstPage'; items: Notification[]; nextToken?: string }
  // An older page requested with "Load more".
  | { type: 'nextPage'; items: Notification[]; nextToken?: string }
  // One notification changed (WebSocket push, or the response to a create).
  | { type: 'upsert'; notification: Notification };

export const initialState: State = { byId: {}, loaded: false };

// A push can arrive before the POST response, and a refetch can overlap a push. Whichever copy
// has the newer updatedAt wins, so an old copy never overwrites a newer one.
const merge = (byId: State['byId'], incoming: Notification[]): State['byId'] => {
  const next = { ...byId };
  for (const item of incoming) {
    const existing = next[item.id];
    if (!existing || item.updatedAt >= existing.updatedAt) next[item.id] = item;
  }
  return next;
};

export const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case 'firstPage':
      return {
        byId: merge(state.byId, action.items),
        // After the first load the cursor belongs to the page the user has scrolled to, so a
        // refetch must not move it back.
        nextToken: state.loaded ? state.nextToken : action.nextToken,
        loaded: true,
      };
    case 'nextPage':
      return { ...state, byId: merge(state.byId, action.items), nextToken: action.nextToken };
    case 'upsert':
      return { ...state, byId: merge(state.byId, [action.notification]) };
  }
};

// Newest first.
export const sorted = (state: State): Notification[] =>
  Object.values(state.byId).sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)
  );

export type Filter = 'ALL' | NotificationStatus;

export const countBy = (items: Notification[], filter: Filter): number =>
  filter === 'ALL' ? items.length : items.filter((n) => n.status === filter).length;
