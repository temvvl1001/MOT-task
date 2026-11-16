import type { Notification, NotificationStatus } from '../types';

export interface State {
  byId: Record<string, Notification>;
  // Дараагийн (хуучин) хуудасны cursor, сүүлийн хуудсанд байхгүй.
  nextToken?: string;
  loaded: boolean;
}

export type Action =
  // Хамгийн шинэ хуудас: анхны ачаалал, эсвэл WebSocket дахин холбогдсоны дараах дахин таталт.
  | { type: 'firstPage'; items: Notification[]; nextToken?: string }
  // "Цааш үзэх"-ээр авсан хуучин хуудас.
  | { type: 'nextPage'; items: Notification[]; nextToken?: string }
  // Нэг notification өөрчлөгдсөн (WebSocket push, эсвэл үүсгэсний хариу).
  | { type: 'upsert'; notification: Notification };

export const initialState: State = { byId: {}, loaded: false };

// Push нь POST-ийн хариунаас түрүүлж ирж болно, мөн дахин таталт push-тэй давхцаж болно. updatedAt
// нь шинэ хувилбар ялах тул хуучин хувилбар шинийг хэзээ ч дардаггүй.
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
        // Эхний ачааллын дараа cursor нь хэрэглэгчийн гүйлгэсэн хуудсанд харьяалагдах тул дахин
        // таталт түүнийг ухраах ёсгүй.
        nextToken: state.loaded ? state.nextToken : action.nextToken,
        loaded: true,
      };
    case 'nextPage':
      return { ...state, byId: merge(state.byId, action.items), nextToken: action.nextToken };
    case 'upsert':
      return { ...state, byId: merge(state.byId, [action.notification]) };
  }
};

// Шинэ нь эхэнд.
export const sorted = (state: State): Notification[] =>
  Object.values(state.byId).sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)
  );

export type Filter = 'ALL' | NotificationStatus;

export const countBy = (items: Notification[], filter: Filter): number =>
  filter === 'ALL' ? items.length : items.filter((n) => n.status === filter).length;
