import { useCallback, useState } from 'react';
import { AuthForm } from './components/AuthForm';
import { NotificationForm } from './components/NotificationForm';
import { NotificationList } from './components/NotificationList';
import { loadSession, signOut, type Session } from './auth';
import { missingConfig } from './config';
import { useNotifications } from './hooks/useNotifications';
import { t } from './i18n';

// Зөвхөн нэвтэрсэн үед холбогдоно, тиймээс WebSocket, хүсэлт бүрийн ард хэрэглэгч байна.
function Dashboard({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const notifications = useNotifications(onSignOut);

  return (
    <>
      <header>
        <h1>{t.title}</h1>
        <span className={`conn ${notifications.connection}`}>
          {t.connection[notifications.connection]}
        </span>
      </header>
      <p className="account">
        {session.email}{' '}
        <button type="button" className="link-button" onClick={onSignOut}>
          {t.account.signOut}
        </button>
      </p>
      <NotificationForm onCreate={notifications.create} />
      <NotificationList
        items={notifications.items}
        loaded={notifications.loaded}
        hasMore={notifications.hasMore}
        loadingMore={notifications.loadingMore}
        error={notifications.loadError}
        onLoadMore={notifications.loadMore}
      />
    </>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(loadSession);

  const handleSignOut = useCallback(() => {
    signOut();
    setSession(null);
  }, []);

  const missing = missingConfig();
  if (missing.length > 0) {
    return (
      <div className="feedback error" role="alert">
        {t.config.missing(missing)}
      </div>
    );
  }

  if (!session) {
    return (
      <>
        <header>
          <h1>{t.title}</h1>
        </header>
        <AuthForm onSignedIn={setSession} />
      </>
    );
  }

  return <Dashboard session={session} onSignOut={handleSignOut} />;
}
