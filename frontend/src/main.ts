import { createNotification, listNotifications } from './api';
import { connectWebSocket, type ConnectionState } from './ws';
import type { Channel, Notification , NotificationStatus} from './types';

import './style.css';

const app = document.querySelector<HTMLDivElement>('#app')!;

app.innerHTML = `
  <header>
    <h1>Notification Requests</h1>
    <span id="conn" class="conn closed">connecting...</span>
  </header>
  <form id="form" novalidate>
    <label>Recipient
      <input name="recipient" type="text" placeholder="bold@example.com" required />
    </label>
    <label>Channel
      <select name="channel">
        <option value="EMAIL">Email</option>
        <option value="SMS">SMS</option>
        <option value="PUSH">Push</option>
      </select>
    </label>
    <label>Message
      <textarea name="message" rows="3" maxlength="500" required></textarea>
    </label>
    <button type="submit">Send notification</button>
  </form>
  <div id="feedback" role="status" aria-live="polite"></div>
   <h2>Requests</h2>
  <div id="filters" class="filters"></div>
  <ul id="list" class="list"></ul>
`;

const form = document.querySelector<HTMLFormElement>('#form')!;
const button = form.querySelector<HTMLButtonElement>('button')!;
const feedback = document.querySelector<HTMLDivElement>('#feedback')!;
const list = document.querySelector<HTMLUListElement>('#list')!;
const filters = document.querySelector<HTMLDivElement>('#filters')!;
const conn = document.querySelector<HTMLSpanElement>('#conn')!;

// ---- state ----
const notifications = new Map<string, Notification>();

type Filter = 'ALL' | NotificationStatus;
const FILTERS: Filter[] = ['ALL', 'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'];
let activeFilter: Filter = 'ALL';

// Keep the newest version. A WebSocket push can arrive before the POST
// response, so never let an older copy overwrite a newer one.
function upsert(incoming: Notification) {
  const existing = notifications.get(incoming.id);
  if (!existing || incoming.updatedAt >= existing.updatedAt) {
    notifications.set(incoming.id, incoming);
  }
  render();
}

// ---- rendering ----
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function card(n: Notification): HTMLLIElement {
  const li = el('li', 'card');

  const top = el('div', 'card-top');
  top.append(
    el('strong', undefined, n.recipient),
    el('span', `badge ${n.status.toLowerCase()}`, n.status)
  );

  li.append(
    top,
    el('div', 'meta', `${n.channel} · ${new Date(n.createdAt).toLocaleString()}`),
    el('p', 'message', n.message)
  );
  if (n.result) li.append(el('div', 'result', n.result));
  return li;
}
function renderFilters(all: Notification[]) {
  const chips = FILTERS.map((f) => {
    const count = f === 'ALL' ? all.length : all.filter((n) => n.status === f).length;
    const chip = el('button', `chip${f === activeFilter ? ' active' : ''}`, `${f} (${count})`);
    chip.type = 'button';
    chip.addEventListener('click', () => {
      activeFilter = f;
      render();
    });
    return chip;
  });
  filters.replaceChildren(...chips);
}

  function render() {
  const all = [...notifications.values()].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );
  renderFilters(all);

  const items = activeFilter === 'ALL' ? all : all.filter((n) => n.status === activeFilter);
  if (items.length === 0) {
    const text = all.length === 0 ? 'No requests yet.' : `No ${activeFilter} requests.`;
    list.replaceChildren(el('li', 'empty', text));
    return;
  }
  list.replaceChildren(...items.map(card));
}

function showFeedback(kind: 'success' | 'error', text: string) {
  feedback.className = `feedback ${kind}`;
  feedback.textContent = text;
}

function setConnection(state: ConnectionState) {
  conn.className = `conn ${state}`;
  conn.textContent = state === 'open' ? 'live' : state === 'connecting' ? 'connecting...' : 'offline';
}

// ---- data loading ----
async function loadList() {
  try {
    (await listNotifications()).forEach((n) => upsert(n));
  } catch (err) {
    showFeedback('error', err instanceof Error ? err.message : 'Failed to load requests');
  }
}

// ---- form ----
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(form);

  button.disabled = true;
  button.textContent = 'Sending...';
  feedback.textContent = '';
  feedback.className = '';

  try {
    const created = await createNotification({
      recipient: String(data.get('recipient') ?? ''),
      channel: data.get('channel') as Channel,
      message: String(data.get('message') ?? ''),
    });
    upsert(created);
    showFeedback('success', `Request created (${created.status}). ID: ${created.id}`);
    form.reset();
  } catch (err) {
    showFeedback('error', err instanceof Error ? err.message : 'Something went wrong');
  } finally {
    button.disabled = false;
    button.textContent = 'Send notification';
  }
});

// ---- start ----
render();
void loadList();
connectWebSocket({
  onUpdate: upsert,
  onState: setConnection,
  onReconnect: () => void loadList(),
});