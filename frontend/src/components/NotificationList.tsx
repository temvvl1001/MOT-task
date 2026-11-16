import { useState } from 'react';
import { t } from '../i18n';
import { countBy, type Filter } from '../state/notificationsReducer';
import type { Notification } from '../types';

const FILTERS: Filter[] = ['ALL', 'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'];

const filterLabel = (filter: Filter) => (filter === 'ALL' ? t.list.all : t.status[filter]);

interface Props {
  items: Notification[];
  loaded: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  error: string | null;
  onLoadMore: () => void;
}

function Card({ notification: n }: { notification: Notification }) {
  return (
    <li className="card">
      <div className="card-top">
        <strong>{n.recipient}</strong>
        <span className={`badge ${n.status.toLowerCase()}`}>{t.status[n.status]}</span>
      </div>
      <div className="meta">
        {t.channels[n.channel]} · {new Date(n.createdAt).toLocaleString('mn')}
        {n.attempts > 1 && ` · ${t.list.attempt(n.attempts)}`}
      </div>
      <p className="message">{n.message}</p>
      {n.result && <div className="result">{n.result}</div>}
    </li>
  );
}

export function NotificationList({ items, loaded, hasMore, loadingMore, error, onLoadMore }: Props) {
  const [filter, setFilter] = useState<Filter>('ALL');
  const visible = filter === 'ALL' ? items : items.filter((n) => n.status === filter);

  return (
    <section>
      <h2>{t.list.title}</h2>
      <div className="filters">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className={`chip${f === filter ? ' active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {filterLabel(f)} ({countBy(items, f)})
          </button>
        ))}
      </div>

      {error && (
        <div className="feedback error" role="alert">
          {error}
        </div>
      )}

      <ul className="list">
        {visible.map((n) => (
          <Card key={n.id} notification={n} />
        ))}
        {visible.length === 0 && (
          <li className="empty">
            {!loaded
              ? t.list.loading
              : items.length === 0
                ? t.list.empty
                : t.list.noneWithStatus(filterLabel(filter), hasMore)}
          </li>
        )}
      </ul>

      {hasMore && (
        <button type="button" className="chip load-more" onClick={onLoadMore} disabled={loadingMore}>
          {loadingMore ? t.list.loadingMore : t.list.loadMore}
        </button>
      )}
    </section>
  );
}
