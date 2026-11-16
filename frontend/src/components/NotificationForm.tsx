import { useRef, useState, type FormEvent } from 'react';
import { attemptFor, contentOf, type Attempt } from '../idempotency';
import { t } from '../i18n';
import type { Channel, CreateNotificationInput, Notification } from '../types';

interface Props {
  onCreate: (
    input: CreateNotificationInput,
    idempotencyKey: string
  ) => Promise<{ notification: Notification; delayed: boolean }>;
}

type Feedback = { kind: 'success' | 'error'; text: string } | null;

export function NotificationForm({ onCreate }: Props) {
  const [recipient, setRecipient] = useState('');
  const [channel, setChannel] = useState<Channel>('EMAIL');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  // The key stands for one request. Pressing Send again with the same content reuses it, so the
  // server can never create two notifications. Changing the content starts a new key.
  const attempt = useRef<Attempt>({ key: crypto.randomUUID(), content: '' });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);
    const input = { recipient, channel, message };
    attempt.current = attemptFor(attempt.current, contentOf(input));
    try {
      const { notification, delayed } = await onCreate(input, attempt.current.key);
      setFeedback({
        kind: 'success',
        text: delayed ? t.form.delayed(notification.recipient) : t.form.sent(notification.recipient),
      });
      setRecipient('');
      setMessage('');
    } catch (err) {
      setFeedback({ kind: 'error', text: err instanceof Error ? err.message : t.errors.generic });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <form className="card-form" onSubmit={submit} noValidate>
        <label>
          {t.form.recipient}
          <input
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder={t.form.recipientPlaceholder}
          />
        </label>
        <p className="hint">
          {t.form.hintBefore} <code>fail@…</code> ({t.form.hintFail}), <code>flaky@…</code> (
          {t.form.hintFlaky}), <code>outage@…</code> ({t.form.hintOutage}).
        </p>
        <label>
          {t.form.channel}
          <select value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
            {(Object.keys(t.channels) as Channel[]).map((c) => (
              <option key={c} value={c}>
                {t.channels[c]}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.form.message}
          <textarea
            rows={3}
            maxLength={500}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? t.form.sending : t.form.send}
        </button>
      </form>
      <div role="status" aria-live="polite">
        {feedback && <div className={`feedback ${feedback.kind}`}>{feedback.text}</div>}
      </div>
    </>
  );
}
