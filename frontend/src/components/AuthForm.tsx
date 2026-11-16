import { useState, type FormEvent } from 'react';
import { signIn, signUp, type Session } from '../auth';
import { t } from '../i18n';

interface Props {
  onSignedIn: (session: Session) => void;
}

export function AuthForm({ onSignedIn }: Props) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const action = mode === 'signin' ? signIn : signUp;
      onSignedIn(await action(email.trim().toLowerCase(), password));
    } catch (err) {
      setError(err instanceof Error ? err.message : t.auth.failed);
      setBusy(false);
    }
  };

  return (
    <form className="card-form" onSubmit={submit}>
      <h2 className="form-title">{mode === 'signin' ? t.auth.signInTitle : t.auth.signUpTitle}</h2>
      <label>
        {t.auth.email}
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </label>
      <label>
        {t.auth.password}
        <input
          type="password"
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
        />
      </label>
      {mode === 'signup' && <p className="hint">{t.auth.passwordHint}</p>}
      {error && (
        <div className="feedback error" role="alert">
          {error}
        </div>
      )}
      <button type="submit" disabled={busy}>
        {busy ? t.auth.wait : mode === 'signin' ? t.auth.signIn : t.auth.signUp}
      </button>
      <button
        type="button"
        className="link-button"
        onClick={() => {
          setMode(mode === 'signin' ? 'signup' : 'signin');
          setError(null);
        }}
      >
        {mode === 'signin' ? t.auth.toSignUp : t.auth.toSignIn}
      </button>
    </form>
  );
}
