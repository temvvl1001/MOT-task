// End-to-end test against a DEPLOYED stack. It signs up real Cognito users, drives the real API and
// WebSocket, and (for the failure scenarios that cannot be produced through the API) talks to
// DynamoDB, SQS and Lambda directly with the AWS CLI.
//
//   API_URL=https://<id>.execute-api.<region>.amazonaws.com \
//   WS_URL=wss://<id>.execute-api.<region>.amazonaws.com/dev \
//   COGNITO_CLIENT_ID=<client id> \
//   node scripts/e2e.mjs
//
// Optional: COGNITO_REGION (default ap-southeast-2), STAGE (default dev), AWS_DIRECT=0 to skip the
// checks that need AWS CLI credentials.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const need = (name) => {
  if (!process.env[name]) {
    console.error(`Missing environment variable ${name}`);
    process.exit(2);
  }
  return process.env[name];
};

const API = need('API_URL').replace(/\/$/, '');
const WS = need('WS_URL');
const CLIENT_ID = need('COGNITO_CLIENT_ID');
const REGION = process.env.COGNITO_REGION ?? 'ap-southeast-2';
const STAGE = process.env.STAGE ?? 'dev';
const DIRECT = process.env.AWS_DIRECT !== '0';
const PREFIX = `notification-system-${STAGE}`;
const TABLE = `${PREFIX}-notifications`;
const SWEEPER = `${PREFIX}-requeueStale`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- AWS CLI (direct access, only for scenarios the API cannot create) ----------
const aws = (...args) => {
  const out = execFileSync('aws', [...args, '--region', REGION, '--output', 'json'], {
    encoding: 'utf8',
  });
  return out.trim() ? JSON.parse(out) : {};
};
const queueUrl = (suffix) =>
  aws('sqs', 'get-queue-url', '--queue-name', `${PREFIX}-${suffix}`).QueueUrl;
const sendMessage = (url, body) =>
  aws('sqs', 'send-message', '--queue-url', url, '--message-body', JSON.stringify(body));
const putPendingItem = ({ id, userId, minutesAgo }) => {
  const at = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  aws(
    'dynamodb', 'put-item', '--table-name', TABLE, '--item',
    JSON.stringify({
      id: { S: id }, userId: { S: userId }, recipient: { S: 'repair@example.com' },
      channel: { S: 'EMAIL' }, message: { S: 'seeded' }, status: { S: 'PENDING' },
      attempts: { N: '0' }, createdAt: { S: at }, updatedAt: { S: at },
    })
  );
};

// ---------- Cognito ----------
const cognito = async (target, body) => {
  const res = await fetch(`https://cognito-idp.${REGION}.amazonaws.com/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${target}: ${data.message ?? data.__type}`);
  return data;
};

const newUser = async () => {
  const email = `e2e-${randomUUID().slice(0, 8)}@example.com`;
  const password = 'Passw0rdTest1';
  await cognito('SignUp', {
    ClientId: CLIENT_ID,
    Username: email,
    Password: password,
    UserAttributes: [{ Name: 'email', Value: email }],
  });
  const auth = await cognito('InitiateAuth', {
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: CLIENT_ID,
    AuthParameters: { USERNAME: email, PASSWORD: password },
  });
  const token = auth.AuthenticationResult.IdToken;
  const sub = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub;
  return { email, token, sub };
};

// ---------- HTTP ----------
const call = async (token, method, path, { body, headers } = {}) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
};
const create = (user, recipient, extra = {}) =>
  call(user.token, 'POST', '/notifications', {
    body: { recipient, channel: 'EMAIL', message: 'e2e', ...extra.body },
    headers: extra.headers,
  });

// ---------- WebSocket ----------
const openSocket = (token) =>
  new Promise((resolve, reject) => {
    const url = token === undefined ? WS : `${WS}?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);
    const events = [];
    const timer = setTimeout(() => reject(new Error('timeout while connecting')), 10_000);
    ws.onmessage = (e) => events.push(JSON.parse(e.data));
    ws.onopen = () => { clearTimeout(timer); resolve({ ws, events, close: () => ws.close() }); };
    ws.onerror = () => { clearTimeout(timer); reject(new Error('connection refused')); };
  });
const isRejected = async (token) => {
  try { (await openSocket(token)).close(); return false; } catch { return true; }
};
const waitFor = async (predicate, what, ms = 70_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = predicate();
    if (value) return value;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${what}`);
};
const updatesOf = (socket, id) =>
  socket.events.filter((e) => e.notification.id === id).map((e) => e.notification);
const finished = (socket, id) => () =>
  updatesOf(socket, id).find((n) => n.status === 'COMPLETED' || n.status === 'FAILED');

// ---------- tiny test runner ----------
const results = [];
const check = async (name, fn) => {
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - started });
    console.log(`PASS  ${name}`);
  } catch (err) {
    results.push({ name, ok: false, ms: Date.now() - started, error: err.message });
    console.log(`FAIL  ${name}\n      ${err.message}`);
  }
};
const expect = (cond, message) => { if (!cond) throw new Error(message); };
const eq = (actual, expected, label) =>
  expect(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );

// ======================================================================================
console.log(`Testing ${API}\n`);
const [alice, bob, carol] = await Promise.all([newUser(), newUser(), newUser()]);
const aliceTab1 = await openSocket(alice.token);
const aliceTab2 = await openSocket(alice.token);
const bobTab = await openSocket(bob.token);

// ---- The deployed frontend ----
await check('Frontend: HTTPS дээр, CSP ба аюулгүй байдлын header-тэй, deep link index.html-ээр хариулна', async () => {
  const page = await fetch(`${API}/`);
  eq(page.status, 200, 'GET /');
  expect((page.headers.get('content-type') ?? '').startsWith('text/html'), 'GET / is not html');
  const csp = page.headers.get('content-security-policy') ?? '';
  expect(csp.includes("default-src 'self'") && csp.includes("frame-ancestors 'none'"), `weak CSP: ${csp}`);
  expect(!csp.includes('unsafe-inline') && !csp.includes('unsafe-eval'), 'CSP allows unsafe scripts');
  eq(page.headers.get('x-content-type-options'), 'nosniff', 'x-content-type-options');
  expect((page.headers.get('strict-transport-security') ?? '').includes('max-age'), 'missing HSTS');
  eq(page.headers.get('cache-control'), 'no-cache', 'index.html cache-control');

  const html = await page.text();
  const asset = html.match(/\/assets\/[^"']+\.js/)?.[0];
  expect(asset, 'index.html does not reference a script');
  const script = await fetch(`${API}${asset}`);
  eq(script.status, 200, 'script status');
  expect((script.headers.get('cache-control') ?? '').includes('immutable'), 'hashed asset is not cached');

  eq((await fetch(`${API}/some/deep/link`)).status, 200, 'deep link');
  eq((await fetch(`${API}/assets/missing.js`)).status, 404, 'missing asset');
  // fetch() flattens "%2e%2e" itself, so the request that arrives is a plain unknown page. What
  // matters is that no file outside the web root is ever served.
  const probe = await (await fetch(`${API}/%2e%2e/%2e%2e/etc/passwd`)).text();
  expect(!probe.includes('root:') && !probe.includes('/bin/'), 'a system file was served');
});

// ---- Authentication and authorization ----
await check('HTTP: token-гүй хүсэлт татгалзагдана (401)', async () => {
  eq((await call(undefined, 'GET', '/notifications')).status, 401, 'GET');
  eq((await call(undefined, 'POST', '/notifications', { body: { recipient: 'a@b.c', channel: 'EMAIL', message: 'x' } })).status, 401, 'POST');
});
await check('HTTP: хуурамч token татгалзагдана (401)', async () => {
  eq((await call('not.a.jwt', 'GET', '/notifications')).status, 401, 'GET');
});
await check('WebSocket: token-гүй холболт татгалзагдана', async () => {
  expect(await isRejected(undefined), 'connection was accepted');
});
await check('WebSocket: хуурамч token-тэй холболт татгалзагдана', async () => {
  expect(await isRejected('not.a.jwt'), 'connection was accepted');
});

// ---- Validation ----
await check('POST шалгалт: 400 ба тогтвортой алдааны код буцаана', async () => {
  const bad = (body) => call(alice.token, 'POST', '/notifications', { body });
  eq((await bad('{oops')).body, { code: 'invalid_json', error: 'Invalid JSON' }, 'invalid JSON');
  eq((await bad({ recipient: '', channel: 'EMAIL', message: 'x' })).body, { code: 'recipient_required', error: 'recipient is required' }, 'recipient');
  eq((await bad({ recipient: 'a@b.c', channel: 'FAX', message: 'x' })).body.code, 'invalid_channel', 'channel');
  eq((await bad({ recipient: 'a@b.c', channel: 'EMAIL', message: 'x'.repeat(501) })).body.code, 'message_too_long', 'long message');
  eq((await call(alice.token, 'POST', '/notifications', { body: { recipient: 'a@b.c', channel: 'EMAIL', message: 'x' }, headers: { 'Idempotency-Key': 'short' } })).body.code, 'invalid_idempotency_key', 'idempotency key');
});

// ---- Processing scenarios (run in parallel, each takes up to ~30 s because of the backoff) ----
const created = {};
await Promise.all([
  check('Амжилт: PENDING -> PROCESSING -> COMPLETED, WebSocket-ээр, polling-гүй', async () => {
    const res = await create(alice, 'bold@example.com');
    eq(res.status, 201, 'status code');
    eq(res.body.status, 'PENDING', 'initial status');
    const id = (created.ok = res.body.id);
    const done = await waitFor(finished(aliceTab1, id), 'completion push');
    eq(done.status, 'COMPLETED', 'final status');
    expect(done.result.includes('амжилттай хүргэлээ'), `unexpected result: ${done.result}`);
    eq(updatesOf(aliceTab1, id).map((n) => n.status), ['PROCESSING', 'COMPLETED'], 'pushed statuses');
  }),
  check('Амжилт: нэг хэрэглэгчийн хоёр дахь tab ижил update-ийг авна', async () => {
    const id = await waitFor(() => created.ok, 'created id');
    await waitFor(finished(aliceTab2, id), 'completion push on tab 2');
    eq(updatesOf(aliceTab2, id).map((n) => n.status), ['PROCESSING', 'COMPLETED'], 'tab 2 statuses');
  }),
  check('Байнгын алдаа: шууд FAILED, дахин оролдохгүй', async () => {
    const res = await create(alice, 'fail@example.com');
    const id = res.body.id;
    const done = await waitFor(finished(aliceTab1, id), 'failure push');
    eq(done.status, 'FAILED', 'final status');
    eq(done.attempts, 1, 'attempts');
    expect(done.result.includes('татгалзагдлаа'), `unexpected result: ${done.result}`);
    eq(updatesOf(aliceTab1, id).map((n) => n.status), ['PROCESSING', 'FAILED'], 'pushed statuses');
  }),
  check('Түр зуурын алдаа: backoff-той дахин оролдож, 3-р оролдлогод COMPLETED', async () => {
    const id = (await create(alice, 'flaky@example.com')).body.id;
    const done = await waitFor(finished(aliceTab1, id), 'recovery push');
    eq(done.status, 'COMPLETED', 'final status');
    eq(done.attempts, 3, 'attempts');
    const statuses = updatesOf(aliceTab1, id).map((n) => n.status);
    eq(statuses, ['PROCESSING', 'PENDING', 'PROCESSING', 'PENDING', 'PROCESSING', 'COMPLETED'], 'pushed statuses');
    expect(updatesOf(aliceTab1, id).some((n) => n.result?.includes('Дахин оролдоно')), 'no retry message was pushed');
  }),
  check('Түр зуурын алдаа сэргэхгүй бол: сүүлийн оролдлогын дараа FAILED', async () => {
    const id = (await create(alice, 'outage@example.com')).body.id;
    const done = await waitFor(finished(aliceTab1, id), 'give-up push');
    eq(done.status, 'FAILED', 'final status');
    eq(done.attempts, 3, 'attempts');
    expect(done.result.startsWith('3 оролдлогын дараа бууж өгөв'), `unexpected result: ${done.result}`);
  }),
]);

// ---- Data isolation ----
await check('Тусгаарлалт: өөр хэрэглэгч бусдын notification, live update-ийг хардаггүй', async () => {
  const bobsList = await call(bob.token, 'GET', '/notifications');
  eq(bobsList.status, 200, 'status');
  eq(bobsList.body.items, [], "Bob's list");
  eq(bobTab.events.length, 0, "events Bob's socket received");
});
await check('Тусгаарлалт: өөр хэрэглэгчийн pagination cursor татгалзагдана', async () => {
  const page = await call(alice.token, 'GET', '/notifications?limit=1');
  expect(page.body.nextToken, 'Alice needs a second page for this check');
  eq((await call(bob.token, 'GET', `/notifications?nextToken=${page.body.nextToken}`)).status, 400, 'status');
});

// ---- Pagination ----
await check('Pagination: 5 мөрийг 2-оор унших, шинэ нь эхэнд, давхардал ба алдагдалгүй', async () => {
  const ids = [];
  for (let i = 1; i <= 5; i++) {
    ids.unshift((await create(carol, `page${i}@example.com`)).body.id);
    await sleep(50);
  }
  const end = Date.now() + 30_000;
  let total = 0;
  while (Date.now() < end && total < 5) {
    total = (await call(carol.token, 'GET', '/notifications?limit=50')).body.items.length;
    if (total < 5) await sleep(500);
  }
  eq(total, 5, 'items visible through the index');

  const seen = [];
  const sizes = [];
  let token;
  do {
    const page = await call(carol.token, 'GET', `/notifications?limit=2${token ? `&nextToken=${token}` : ''}`);
    eq(page.status, 200, 'page status');
    sizes.push(page.body.items.length);
    seen.push(...page.body.items.map((n) => n.id));
    token = page.body.nextToken;
  } while (token);
  eq(sizes, [2, 2, 1], 'page sizes');
  eq(seen, ids, 'order (newest first, nothing missing or repeated)');
});

// ---- Idempotency ----
await check('Idempotency-Key: давтагдсан хүсэлт яг нэг notification үүсгэнэ', async () => {
  const headers = { 'Idempotency-Key': `e2e-${randomUUID()}` };
  const first = await create(bob, 'idem@example.com', { headers });
  const again = await create(bob, 'idem@example.com', { headers });
  eq(first.status, 201, 'first status');
  eq(again.status, 200, 'second status');
  eq(again.body.id, first.body.id, 'same id');
  await waitFor(finished(bobTab, first.body.id), 'completion push');
  eq(updatesOf(bobTab, first.body.id).filter((n) => n.status === 'COMPLETED').length, 1, 'completions');

  // The same key for a DIFFERENT request must be refused, not answered with the old notification.
  const reused = await create(bob, 'idem@example.com', { headers, body: { message: 'өөр агуулга' } });
  eq(reused.status, 409, 'status when the key is reused');
  eq(reused.body.code, 'idempotency_key_reused', 'code when the key is reused');
});

// ---- Duplicate processing and partial failure (need direct AWS access) ----
if (DIRECT) {
  const mainQueue = queueUrl('queue');
  const dlq = queueUrl('dlq');

  // A freshly created index cannot be read until DynamoDB finished backfilling it, which can
  // take a few minutes after a deploy that added it.
  const indexReady = () =>
    aws('dynamodb', 'describe-table', '--table-name', TABLE).Table.GlobalSecondaryIndexes.every(
      (index) => index.IndexStatus === 'ACTIVE'
    );
  for (let i = 0; i < 40 && !indexReady(); i++) {
    if (i === 0) console.log('...waiting for DynamoDB indexes to become ACTIVE');
    await sleep(15_000);
  }

  await check('Давхар SQS хүргэлт: notification яг нэг удаа боловсруулагдана', async () => {
    const socket = await openSocket(carol.token); // open first so no push is missed
    const id = (await create(carol, 'dupe@example.com')).body.id;
    for (let i = 0; i < 3; i++) sendMessage(mainQueue, { id }); // three extra copies of the message
    await waitFor(finished(socket, id), 'completion push');
    await sleep(10_000); // give any wrongly processed duplicate time to show up
    eq(updatesOf(socket, id).map((n) => n.status), ['PROCESSING', 'COMPLETED'], 'pushed statuses');
    socket.close();
  });

  await check('Хэсэгчилсэн алдаа: SQS-д хүрээгүй PENDING мөрийг sweeper дахин оруулна', async () => {
    const id = randomUUID();
    putPendingItem({ id, userId: carol.sub, minutesAgo: 10 }); // saved in DynamoDB, never queued
    const socket = await openSocket(carol.token);
    await sleep(3000); // let the byStatus index catch up
    aws('lambda', 'invoke', '--function-name', SWEEPER, join(tmpdir(), 'sweeper-out.json'));
    const done = await waitFor(finished(socket, id), 'completion after the sweep', 40_000);
    eq(done.status, 'COMPLETED', 'final status');
    socket.close();
  });

  await check('Dead-letter queue: DLQ-д орсон notification FAILED болно', async () => {
    const id = randomUUID();
    putPendingItem({ id, userId: carol.sub, minutesAgo: 10 });
    const socket = await openSocket(carol.token);
    sendMessage(dlq, { id });
    const done = await waitFor(finished(socket, id), 'dead-letter push', 40_000);
    eq(done.status, 'FAILED', 'final status');
    expect(done.result.includes('DLQ'), `unexpected result: ${done.result}`);
    socket.close();
  });

  // ---- Infrastructure audit: the deployed resources really match what the README claims ----
  const functionName = (name) => `${PREFIX}-${name}`;
  const actionsOfRole = (roleName) => {
    const actions = new Set();
    const wildcardResources = [];
    for (const policy of aws('iam', 'list-role-policies', '--role-name', roleName).PolicyNames) {
      const { Statement } = aws('iam', 'get-role-policy', '--role-name', roleName, '--policy-name', policy).PolicyDocument;
      for (const statement of [].concat(Statement)) {
        for (const action of [].concat(statement.Action)) {
          if (!action.startsWith('logs:')) actions.add(action);
        }
        if ([].concat(statement.Resource).includes('*')) wildcardResources.push(statement.Action);
      }
    }
    return { actions: [...actions].sort(), wildcardResources };
  };

  await check('IAM: функц бүр зөвхөн өөрт хэрэгтэй эрхтэй, "*" нөөц байхгүй (wsAuthorizer, preSignUp зөвхөн лог)', async () => {
    const expected = {
      createNotification: ['dynamodb:GetItem', 'dynamodb:PutItem', 'sqs:SendMessage'],
      listNotifications: ['dynamodb:Query'],
      worker: ['dynamodb:DeleteItem', 'dynamodb:Query', 'dynamodb:UpdateItem', 'execute-api:ManageConnections', 'sqs:ChangeMessageVisibility', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes', 'sqs:ReceiveMessage'],
      dlqProcessor: ['dynamodb:DeleteItem', 'dynamodb:Query', 'dynamodb:UpdateItem', 'execute-api:ManageConnections', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes', 'sqs:ReceiveMessage'],
      requeueStale: ['dynamodb:Query', 'sqs:SendMessage'],
      wsConnect: ['dynamodb:PutItem'],
      wsDisconnect: ['dynamodb:DeleteItem'],
      wsAuthorizer: [],
      preSignUp: [],
    };
    const roles = new Map();
    for (const [name, wanted] of Object.entries(expected)) {
      const role = aws('lambda', 'get-function-configuration', '--function-name', functionName(name)).Role.split('/').pop();
      expect(!roles.has(role), `${name} shares the role ${role} with ${roles.get(role)}`);
      roles.set(role, name);
      const { actions, wildcardResources } = actionsOfRole(role);
      eq(actions, wanted, `${name}: allowed actions`);
      eq(wildcardResources, [], `${name}: statements on Resource "*"`);
    }
  });

  await check('Тохиргоо: PITR, TTL, API throttle ба хяналтын alarm-ууд идэвхтэй', async () => {
    const backups = aws('dynamodb', 'describe-continuous-backups', '--table-name', TABLE);
    eq(backups.ContinuousBackupsDescription.PointInTimeRecoveryDescription.PointInTimeRecoveryStatus, 'ENABLED', 'point-in-time recovery');
    const ttl = aws('dynamodb', 'describe-time-to-live', '--table-name', TABLE).TimeToLiveDescription;
    eq([ttl.TimeToLiveStatus, ttl.AttributeName], ['ENABLED', 'expiresAt'], 'notifications TTL');
    const connTtl = aws('dynamodb', 'describe-time-to-live', '--table-name', `${PREFIX}-connections`).TimeToLiveDescription;
    eq(connTtl.TimeToLiveStatus, 'ENABLED', 'connections TTL');

    const apiId = new URL(API).hostname.split('.')[0];
    const stage = aws('apigatewayv2', 'get-stage', '--api-id', apiId, '--stage-name', '$default');
    eq(
      [stage.DefaultRouteSettings.ThrottlingRateLimit, stage.DefaultRouteSettings.ThrottlingBurstLimit],
      [25, 50],
      'HTTP API throttle (rate, burst)'
    );

    const alarms = aws('cloudwatch', 'describe-alarms', '--alarm-name-prefix', PREFIX).MetricAlarms;
    expect(alarms.length >= 3, `expected at least 3 alarms, found ${alarms.length}`);
  });
} else {
  console.log('SKIP  checks that need direct AWS access (AWS_DIRECT=0)');
}

[aliceTab1, aliceTab2, bobTab].forEach((s) => s.close());

// ---------- report ----------
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} шалгалт давлаа\n`);
console.log('| # | Шалгалт | Үр дүн | Хугацаа |\n|---|---|---|---|');
results.forEach((r, i) =>
  console.log(`| ${i + 1} | ${r.name} | ${r.ok ? 'PASS' : 'FAIL'} | ${(r.ms / 1000).toFixed(1)} s |`)
);
process.exit(passed === results.length ? 0 : 1);
