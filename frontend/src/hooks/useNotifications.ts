import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { ApiError, createNotification, listNotifications } from '../api';
import { AuthError, getValidSession } from '../auth';
import { t } from '../i18n';
import { initialState, reducer, sorted } from '../state/notificationsReducer';
import type { CreateNotificationInput } from '../types';
import { connectWebSocket, type ConnectionState } from '../ws';

const messageOf = (err: unknown) => (err instanceof Error ? err.message : t.errors.generic);

// Everything the screen needs: the list (first page, "load more", live updates) and creating.
export function useNotifications(onAuthError: () => void) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const fail = useCallback(
    (err: unknown) => {
      if (err instanceof AuthError) onAuthError();
      else setLoadError(messageOf(err));
    },
    [onAuthError]
  );

  const loadFirstPage = useCallback(async () => {
    try {
      const page = await listNotifications();
      dispatch({ type: 'firstPage', items: page.items, nextToken: page.nextToken });
      setLoadError(null);
    } catch (err) {
      fail(err);
    }
  }, [fail]);

  useEffect(() => {
    void loadFirstPage();
    return connectWebSocket({
      getToken: async () => (await getValidSession()).idToken,
      onUpdate: (notification) => dispatch({ type: 'upsert', notification }),
      onState: setConnection,
      // Whatever changed while the connection was down is fetched again.
      onReconnect: () => void loadFirstPage(),
      onAuthError,
    });
  }, [loadFirstPage, onAuthError]);

  const loadMore = useCallback(async () => {
    if (!state.nextToken || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await listNotifications(state.nextToken);
      dispatch({ type: 'nextPage', items: page.items, nextToken: page.nextToken });
      setLoadError(null);
    } catch (err) {
      fail(err);
    } finally {
      setLoadingMore(false);
    }
  }, [state.nextToken, loadingMore, fail]);

  const create = useCallback(
    async (input: CreateNotificationInput, idempotencyKey: string) => {
      try {
        const result = await createNotification(input, idempotencyKey);
        dispatch({ type: 'upsert', notification: result.notification });
        return result;
      } catch (err) {
        if (err instanceof AuthError) onAuthError();
        throw err instanceof ApiError || err instanceof AuthError ? err : new Error(messageOf(err));
      }
    },
    [onAuthError]
  );

  const items = useMemo(() => sorted(state), [state]);

  return {
    items,
    loaded: state.loaded,
    hasMore: Boolean(state.nextToken),
    loadingMore,
    loadError,
    connection,
    loadMore,
    create,
  };
}
