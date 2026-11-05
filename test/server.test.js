import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { io } from 'socket.io-client';
import { createServer } from '../server/index.js';

const ROUND_SECONDS = 1;
let base, server, ioServer;
const sockets = [];

before(async () => {
  ({ server, io: ioServer } = createServer({ roundSeconds: ROUND_SECONDS, tickMs: 20, requestLimitPerMinute: 1000 }));
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://localhost:${server.address().port}`;
});

after(async () => {
  sockets.forEach((s) => s.disconnect());
  await ioServer.close();
});

const profile = (name, contact = `${name}@example.com`) => ({
  name: `${name} Lastname`, headline: 'Engineer', industries: ['Fintech'],
  jobs: [{ title: 'Engineer', company: 'Acme' }], schools: [], skills: [], contact,
});

async function user(name, contact) {
  const res = await fetch(`${base}/api/profile`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ adult: true, profile: profile(name, contact) }),
  });
  const { token } = await res.json();
  const socket = io(base, { auth: { token }, transports: ['websocket'] });
  sockets.push(socket);
  await once(socket, 'connect');
  return socket;
}

const once = (socket, event, ms = 3000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), ms);
  socket.once(event, (data) => { clearTimeout(timer); resolve(data); });
});

const silent = (socket, event, ms = 150) => new Promise((resolve, reject) => {
  const handler = () => reject(new Error(`unexpected ${event}`));
  socket.once(event, handler);
  setTimeout(() => { socket.off(event, handler); resolve(); }, ms);
});

async function pair(nameA, nameB, contactA, contactB) {
  const [a, b] = [await user(nameA, contactA), await user(nameB, contactB)];
  const matched = [once(a, 'matched'), once(b, 'matched')];
  a.emit('queue:join');
  b.emit('queue:join');
  const [ma, mb] = await Promise.all(matched);
  return { a, b, ma, mb };
}

test('rejects a profile without the 18+ confirmation or an industry', async () => {
  const post = (body) => fetch(`${base}/api/profile`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post({ profile: profile('A') })).status, 400);
  assert.equal((await post({ adult: true, profile: { ...profile('A'), industries: [] } })).status, 400);
  assert.equal((await post({ adult: true, profile: { ...profile('A'), industries: ['Not real'] } })).status, 400);
});

test('uploads a resume and rejects bad files', async () => {
  const send = (content, name) => {
    const body = new FormData();
    body.append('resume', new Blob([content]), name);
    return fetch(`${base}/api/resume`, { method: 'POST', body });
  };
  const good = await send('Maya Chen\n\nEXPERIENCE\nSoftware Engineer | Stripe | 2020 - Present\nFintech payments backend\n', 'r.txt');
  assert.equal(good.status, 200);
  assert.equal((await good.json()).profile.jobs[0].company, 'Stripe');
  assert.equal((await send('x', 'r.exe')).status, 422);
  assert.equal((await send(Buffer.alloc(6 * 1024 * 1024), 'big.txt')).status, 413);
});

test('sockets need a valid session', async () => {
  const socket = io(base, { auth: { token: 'nope' }, transports: ['websocket'], reconnection: false });
  sockets.push(socket);
  assert.equal((await once(socket, 'connect_error')).message, 'no-session');
});

test('matched users get a public card with first name only and no contact details', async () => {
  const { a, b, ma, mb } = await pair('Ann', 'Bo');
  assert.equal(ma.peer.name, 'Bo');
  assert.equal(mb.peer.name, 'Ann');
  assert.ok(ma.reasons.includes('Both in Fintech'));
  assert.notEqual(ma.polite, mb.polite);
  assert.doesNotMatch(JSON.stringify([ma, mb]), /example\.com|Lastname/);
  a.emit('match:skip', { matchId: ma.matchId });
  await once(b, 'match:ended');
});

test('signals and chat reach the partner only; outsiders are ignored', async () => {
  const { a, b, ma } = await pair('Cy', 'Di');
  const outsider = await user('Eve');
  const { matchId } = ma;

  const signal = once(b, 'signal');
  a.emit('signal', { matchId, data: { hello: 1 } });
  assert.deepEqual((await signal).data, { hello: 1 });

  const chat = once(b, 'chat');
  a.emit('chat', { matchId, text: `  hi${'!'.repeat(1000)}` });
  const { text } = await chat;
  assert.ok(text.startsWith('hi') && text.length === 500);

  const silence = Promise.all([silent(a, 'chat'), silent(b, 'chat'), silent(a, 'signal'), silent(b, 'signal'), silent(a, 'connect:mutual'), silent(a, 'match:ended')]);
  outsider.emit('chat', { matchId, text: 'spam' });
  outsider.emit('signal', { matchId, data: {} });
  outsider.emit('match:connect', { matchId });
  outsider.emit('match:skip', { matchId });
  outsider.emit('match:report', { matchId, reason: 'x' });
  await silence;
  outsider.disconnect();
  a.emit('match:skip', { matchId });
  await once(b, 'match:ended');
});

test('a round ends on time and contact is revealed only when both connect', async () => {
  const { a, b, ma } = await pair('Flo', 'Gus', 'flo@example.com', 'gus@example.com');
  const { matchId } = ma;
  const ended = await Promise.all([once(a, 'match:ended'), once(b, 'match:ended')]);
  assert.equal(ended[0].reason, 'time');

  const pending = once(a, 'connect:pending');
  const requested = once(b, 'connect:requested');
  const noReveal = silent(a, 'connect:mutual');
  a.emit('match:connect', { matchId });
  await Promise.all([pending, requested, noReveal]);

  const mutual = [once(a, 'connect:mutual'), once(b, 'connect:mutual')];
  b.emit('match:connect', { matchId });
  const [toA, toB] = await Promise.all(mutual);
  assert.equal(toA.contact, 'gus@example.com');
  assert.equal(toB.contact, 'flo@example.com');
  assert.equal(toA.name, 'Gus Lastname');
});

test('when someone disconnects mid-call their partner is told', async () => {
  const { a, b } = await pair('Hal', 'Ivy');
  const ended = once(b, 'match:ended');
  a.disconnect();
  assert.equal((await ended).reason, 'left');
});

test('a report hides itself from the reported person and blocks a rematch', async () => {
  const { a, b, ma } = await pair('Jo', 'Kit');
  const ended = [once(a, 'match:ended'), once(b, 'match:ended')];
  a.emit('match:report', { matchId: ma.matchId, reason: 'rude' });
  const [toReporter, toReported] = await Promise.all(ended);
  assert.equal(toReporter.reason, 'reported');
  assert.equal(toReported.reason, 'skipped');

  a.emit('queue:join');
  b.emit('queue:join');
  await Promise.all([silent(a, 'matched', 200), silent(b, 'matched', 200)]);
  a.emit('queue:leave');
  b.emit('queue:leave');
});

test('someone reported by three different people is removed', async () => {
  const target = await user('Zed');
  const removed = once(target, 'removed', 5000);
  for (const name of ['R1', 'R2', 'R3']) {
    const reporter = await user(name);
    const matched = once(reporter, 'matched');
    const targetMatched = once(target, 'matched');
    reporter.emit('queue:join');
    target.emit('queue:join');
    const { matchId } = await matched;
    await targetMatched;
    const ended = once(target, 'match:ended');
    reporter.emit('match:report', { matchId });
    await ended;
    reporter.disconnect();
  }
  await removed;
});

test('rate limiting answers with a readable JSON error', async () => {
  const { server: limited, io: limitedIo } = createServer({ requestLimitPerMinute: 1 });
  await new Promise((resolve) => limited.listen(0, resolve));
  const url = `http://localhost:${limited.address().port}/api/profile`;
  const post = () => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal((await post()).status, 400);
  const blocked = await post();
  assert.equal(blocked.status, 429);
  assert.match((await blocked.json()).error, /Too many attempts/);
  await limitedIo.close();
});
