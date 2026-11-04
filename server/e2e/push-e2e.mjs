// Наскрізний тест сервера нагадувань.
// Піднімає справжній сервер (dotnet run) і фейковий push-сервіс, підписує «браузер»,
// а потім розшифровує отримані повідомлення еталонною бібліотекою http_ece (та сама,
// що в npm-пакеті web-push) і перевіряє VAPID-підпис. Запуск: npm test
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ece from 'http_ece';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUSH_PORT = 5199;
const API_PORT = 5198;
const API = `http://127.0.0.1:${API_PORT}`;
const ORIGIN = 'http://localhost:4200';
const SUBJECT = 'mailto:e2e@example.com';

let failures = 0;
function check(condition, message) {
  if (condition) console.log(`  ok    ${message}`);
  else {
    failures++;
    console.log(`  FAIL  ${message}`);
  }
}

// ---------- фейковий push-сервіс ----------
const received = [];
const pushService = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    if (req.url.startsWith('/push/gone')) {
      res.writeHead(410).end();
      return;
    }
    received.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
    res.writeHead(201).end();
  });
});
await new Promise((r) => pushService.listen(PUSH_PORT, '127.0.0.1', r));

// ---------- сервер ----------
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifegame-e2e-'));
const server = spawn(
  'dotnet',
  ['run', '--no-launch-profile', '--project', path.join(here, '../src/LifeGame.Push')],
  {
    env: {
      ...process.env,
      ASPNETCORE_URLS: API,
      DOTNET_NOLOGO: '1',
      Push__DataDirectory: dataDir,
      Push__AllowInsecureEndpoints: 'true',
      Push__AllowedEndpointHosts__0: '127.0.0.1',
      Push__AllowedOrigins__0: ORIGIN,
      Push__WorkerIntervalSeconds: '1',
      Push__VapidSubject: SUBJECT,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeoutMs, label) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const value = await fn();
    if (value) return value;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function api(method, url, body, headers = {}) {
  const res = await fetch(API + url, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, json: text ? JSON.parse(text) : null };
}

// ---------- «браузер» ----------
function makeBrowser() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return {
    ecdh,
    auth,
    keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') },
    decrypt(body) {
      return JSON.parse(
        ece.decrypt(body, { version: 'aes128gcm', privateKey: ecdh, authSecret: auth }).toString('utf8'),
      );
    },
  };
}

function verifyVapid(headers, publicKey) {
  const match = /^vapid t=([^,]+), k=(.+)$/.exec(headers.authorization ?? '');
  if (!match) return { ok: false, reason: 'no vapid header' };
  const [, jwt, k] = match;
  const [h, c, s] = jwt.split('.');
  const point = Buffer.from(k, 'base64url');
  const key = crypto.createPublicKey({
    key: { kty: 'EC', crv: 'P-256', x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33).toString('base64url') },
    format: 'jwk',
  });
  const ok = crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
  const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
  return { ok: ok && k === publicKey, claims };
}

function kyivTime(offsetMinutes) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Kyiv',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(Date.now() + offsetMinutes * 60_000));
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('hour')}:${get('minute')}`;
}

function kyivDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(new Date());
}

const reminder = (id, time) => ({
  id,
  time,
  enabled: true,
  days: [],
  title: `Квест ${id}`,
  body: `Час для квесту ${id}`,
  url: `./?quest=${id}`,
});

try {
  console.log('Starting server…');
  await waitFor(async () => {
    try {
      return (await fetch(`${API}/health`)).ok;
    } catch {
      return false;
    }
  }, 120_000, 'server start');

  const { json: keyJson } = await api('GET', '/api/push/public-key');
  check(Buffer.from(keyJson.publicKey, 'base64url').length === 65, 'public VAPID key is 65 bytes');

  // CORS
  const preflight = await fetch(`${API}/api/subscriptions`, {
    method: 'OPTIONS',
    headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
  });
  check(preflight.headers.get('access-control-allow-origin') === ORIGIN, 'CORS allows the PWA origin');
  const foreign = await fetch(`${API}/api/push/public-key`, { headers: { Origin: 'https://evil.example.com' } });
  check(!foreign.headers.get('access-control-allow-origin'), 'CORS blocks other origins');

  // валідація
  const browser = makeBrowser();
  const bad = await api('POST', '/api/subscriptions', {
    subscription: { endpoint: 'https://evil.example.com/x', keys: browser.keys },
    timeZone: 'Europe/Kyiv',
  });
  check(bad.status === 400, 'rejects push endpoints on unknown hosts');

  // підписка без нагадувань + прогрес: вечірній квест уже виконано
  const created = await api('POST', '/api/subscriptions', {
    subscription: { endpoint: `http://127.0.0.1:${PUSH_PORT}/push/browser-1`, keys: browser.keys },
    timeZone: 'Europe/Kiev', // так часто відповідає Intl у Chrome і Safari
    reminders: [],
  });
  check(created.status === 201 && created.json.id && created.json.secret, 'creates a subscription');
  const auth = { 'X-Subscription-Secret': created.json.secret };
  const id = created.json.id;

  check((await api('PUT', `/api/subscriptions/${id}/progress`, { date: kyivDate(), doneQuests: [] })).status === 404,
    'requires the subscription secret');

  // тестове повідомлення
  const test = await api('POST', `/api/subscriptions/${id}/test`, undefined, auth);
  check(test.status === 200 && test.json.delivered, 'test push is delivered');
  const testPush = received.shift();
  const testMessage = browser.decrypt(testPush.body);
  check(testMessage.notification.title === 'Гра про життя', 'test push decrypts with http_ece');
  check(testPush.headers['content-encoding'] === 'aes128gcm', 'uses aes128gcm content encoding');
  check(Number(testPush.headers.ttl) > 0 && testPush.headers.urgency === 'high', 'sets TTL and Urgency');
  const vapid = verifyVapid(testPush.headers, keyJson.publicKey);
  check(vapid.ok, 'VAPID JWT signature verifies');
  check(vapid.claims?.aud === `http://127.0.0.1:${PUSH_PORT}` && vapid.claims?.sub === SUBJECT, 'VAPID claims: aud and sub');
  check(vapid.claims?.exp > Date.now() / 1000 && vapid.claims?.exp < Date.now() / 1000 + 24 * 3600, 'VAPID exp within 24h');

  // нагадування: ранок і вечір уже настали, але вечір позначено виконаним
  check((await api('PUT', `/api/subscriptions/${id}/progress`, { date: kyivDate(), doneQuests: ['evening'] }, auth)).status === 204,
    'stores today\'s progress');
  const now = kyivTime(-1);
  const updated = await api('PUT', `/api/subscriptions/${id}`, {
    reminders: [reminder('morning', now), reminder('evening', now), reminder('later', kyivTime(30))],
  }, auth);
  check(updated.status === 204, 'updates reminders');

  const pushed = await waitFor(() => received.length > 0 && received.shift(), 15_000, 'scheduled reminder');
  const message = browser.decrypt(pushed.body);
  check(message.notification.title === 'Квест morning', 'scheduled reminder arrives and decrypts');
  check(message.notification.data.onActionClick.default.url === './?quest=morning', 'notification opens the quest');
  check(pushed.headers.topic === 'morning', 'uses the reminder id as Topic');
  await sleep(3500);
  check(received.length === 0, 'done quest and future reminder are not sent, morning is not repeated');

  // разове нагадування про справу: «Стрижка», час сповіщення вже настав
  const events = await api('PUT', `/api/subscriptions/${id}/events`, {
    events: [
      { id: 'haircut', notifyAt: new Date(Date.now() - 5_000).toISOString(), title: 'Стрижка', body: 'О 14:00 — через 30 хв', url: './?todo=haircut' },
      { id: 'dentist', notifyAt: new Date(Date.now() + 3_600_000).toISOString(), title: 'Стоматолог', body: 'Завтра', url: './' },
    ],
  }, auth);
  check(events.status === 204, 'stores event reminders');
  const eventPush = await waitFor(() => received.length > 0 && received.shift(), 15_000, 'event reminder');
  const eventMessage = browser.decrypt(eventPush.body);
  check(eventMessage.notification.title === 'Стрижка' && eventMessage.notification.tag === 'event-haircut', 'event reminder arrives and decrypts');
  await sleep(2500);
  check(received.length === 0, 'event is sent once, future event waits');

  // протухла підписка видаляється
  const gone = makeBrowser();
  const goneSub = await api('POST', '/api/subscriptions', {
    subscription: { endpoint: `http://127.0.0.1:${PUSH_PORT}/push/gone`, keys: gone.keys },
    timeZone: 'UTC',
  });
  const goneTest = await api('POST', `/api/subscriptions/${goneSub.json.id}/test`, undefined, { 'X-Subscription-Secret': goneSub.json.secret });
  check(goneTest.status === 410, 'expired browser subscription answers 410');
  const afterGone = await api('DELETE', `/api/subscriptions/${goneSub.json.id}`, undefined, { 'X-Subscription-Secret': goneSub.json.secret });
  check(afterGone.status === 404, 'expired subscription was removed');

  // відписка
  check((await api('DELETE', `/api/subscriptions/${id}`, undefined, auth)).status === 204, 'unsubscribes');
  const health = await api('GET', '/health');
  check(health.json.subscriptions === 0, 'no subscriptions left');
} catch (err) {
  failures++;
  console.log(`  FAIL  ${err.message}`);
  console.log(serverLog.split('\n').slice(-30).join('\n'));
} finally {
  server.kill('SIGTERM');
  pushService.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nAll e2e checks passed' : `\n${failures} e2e check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
