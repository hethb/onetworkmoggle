import { randomUUID } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { Server } from 'socket.io';
import { Lobby } from './lobby.js';
import { ProfileSchema, publicCard } from './profile.js';
import { claudeEnabled, parseResume, ResumeError } from './resume.js';
import { INDUSTRIES } from './taxonomy.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const SESSION_TTL_MS = 6 * 60 * 60_000;
const MATCH_RECORD_TTL_MS = 5 * 60_000;
const REPORTS_BEFORE_REMOVAL = 3;
const MAX_CHAT_LENGTH = 500;

function iceServers() {
  const fallback = [{ urls: 'stun:stun.l.google.com:19302' }];
  if (!process.env.ICE_SERVERS) return fallback;
  try {
    return JSON.parse(process.env.ICE_SERVERS);
  } catch {
    console.error('ICE_SERVERS is not valid JSON, using public STUN only');
    return fallback;
  }
}

export function createServer({
  roundSeconds = Number(process.env.ROUND_SECONDS) || 180,
  tickMs = 1000,
  lobbyOptions = {},
  // Per IP, and generous: everyone at an event may share one Wi-Fi address.
  requestLimitPerMinute = 60,
} = {}) {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { maxHttpBufferSize: 64 * 1024 });
  const lobby = new Lobby(lobbyOptions);

  const sessions = new Map(); // token -> { id, profile, createdAt, socket, matchId, reportedBy, removed }
  const matches = new Map(); // matchId -> { a, b, endedAt, timer, connect: Set<userId> }
  const usersById = new Map();

  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY));
  app.use((_req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; connect-src 'self' ws: wss:; media-src 'self' blob:; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    next();
  });
  app.use(express.json({ limit: '32kb' }));
  app.use(express.static(path.join(here, '..', 'public')));

  // Resumes stay in memory for the length of the request and are never written to disk.
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
  const limiter = rateLimit({ windowMs: 60_000, limit: requestLimitPerMinute, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Please wait a minute and try again.' } });

  app.get('/api/config', (_req, res) => {
    res.json({ industries: INDUSTRIES, iceServers: iceServers(), parser: claudeEnabled() ? 'claude' : 'keywords', roundSeconds });
  });

  app.post('/api/resume', limiter, (req, res) => {
    upload.single('resume')(req, res, async (uploadError) => {
      if (uploadError) {
        const tooBig = uploadError.code === 'LIMIT_FILE_SIZE';
        return res.status(tooBig ? 413 : 400).json({ error: tooBig ? 'That file is over 5 MB.' : 'Upload failed.' });
      }
      if (!req.file) return res.status(400).json({ error: 'Choose a resume to upload.' });
      try {
        res.json(await parseResume(req.file.buffer, req.file.originalname));
      } catch (err) {
        if (err instanceof ResumeError) return res.status(422).json({ error: err.message });
        console.error('Resume parsing failed:', err);
        res.status(500).json({ error: "Something went wrong reading that resume. You can enter your details by hand." });
      }
    });
  });

  app.post('/api/profile', limiter, (req, res) => {
    if (req.body?.adult !== true) return res.status(400).json({ error: 'You must confirm you are 18 or older.' });
    const parsed = ProfileSchema.safeParse(req.body.profile);
    if (!parsed.success) {
      const missing = parsed.error.issues[0]?.path[0];
      const message = missing === 'industries' ? 'Pick at least one industry, three at most.' : missing === 'name' ? 'Add your name.' : 'Check your details and try again.';
      return res.status(400).json({ error: message });
    }
    const token = randomUUID();
    const user = { id: randomUUID(), token, profile: parsed.data, createdAt: Date.now(), socket: null, matchId: null, reportedBy: new Set(), removed: false };
    sessions.set(token, user);
    usersById.set(user.id, user);
    res.json({ token });
  });

  const sendStats = () => io.emit('stats', { online: io.of('/').sockets.size, waiting: lobby.waiting.size });

  function endMatch(matchId, reason, actorId) {
    const match = matches.get(matchId);
    if (!match || match.endedAt) return;
    match.endedAt = Date.now();
    clearTimeout(match.timer);
    lobby.remember(match.a, match.b);
    for (const id of [match.a, match.b]) {
      const user = usersById.get(id);
      if (!user) continue;
      if (user.matchId === matchId) user.matchId = null;
      const byYou = id === actorId;
      // The reported person just sees that the other person moved on.
      user.socket?.emit('match:ended', { matchId, reason: reason === 'reported' && !byYou ? 'skipped' : reason, byYou });
    }
    setTimeout(() => matches.delete(matchId), MATCH_RECORD_TTL_MS).unref();
  }

  function startMatch({ a, b, matchId, score, reasons }) {
    const userA = usersById.get(a);
    const userB = usersById.get(b);
    // Someone may have vanished between being queued and this tick.
    if (!userA?.socket || !userB?.socket) {
      for (const user of [userA, userB]) if (user?.socket) lobby.join(user.id, user.profile);
      return;
    }
    const match = { a, b, endedAt: null, connect: new Set() };
    match.timer = setTimeout(() => endMatch(matchId, 'time'), roundSeconds * 1000);
    match.timer.unref();
    matches.set(matchId, match);
    userA.matchId = userB.matchId = matchId;
    const send = (user, peer, polite) => user.socket.emit('matched', {
      matchId, polite, peer: publicCard(peer.profile), reasons, score, seconds: roundSeconds, iceServers: iceServers(),
    });
    send(userA, userB, true);
    send(userB, userA, false);
  }

  // Returns the match and the other person, but only for a member of that match.
  function peerIn(user, matchId) {
    const match = matches.get(matchId);
    if (!match || (match.a !== user.id && match.b !== user.id)) return null;
    return { match, peer: usersById.get(match.a === user.id ? match.b : match.a) };
  }

  io.use((socket, next) => {
    const user = sessions.get(socket.handshake.auth?.token);
    if (!user) return next(new Error('no-session'));
    if (user.removed) return next(new Error('removed'));
    socket.data.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    // A second connection for the same session replaces the first.
    if (user.socket && user.socket !== socket) user.socket.disconnect(true);
    user.socket = socket;
    sendStats();

    socket.on('queue:join', () => {
      if (user.removed || user.matchId) return;
      lobby.join(user.id, user.profile);
      sendStats();
    });

    socket.on('queue:leave', () => {
      lobby.leave(user.id);
      sendStats();
    });

    socket.on('signal', ({ matchId, data } = {}) => {
      const found = peerIn(user, matchId);
      if (found && !found.match.endedAt) found.peer?.socket?.emit('signal', { matchId, data });
    });

    socket.on('chat', ({ matchId, text } = {}) => {
      const found = peerIn(user, matchId);
      if (!found || found.match.endedAt || typeof text !== 'string') return;
      const message = text.trim().slice(0, MAX_CHAT_LENGTH);
      if (message) found.peer?.socket?.emit('chat', { matchId, text: message });
    });

    socket.on('match:skip', ({ matchId } = {}) => {
      if (peerIn(user, matchId)) endMatch(matchId, 'skipped', user.id);
    });

    socket.on('match:connect', ({ matchId } = {}) => {
      const found = peerIn(user, matchId);
      if (!found || !found.peer) return;
      const { match, peer } = found;
      if (lobby.blocks.get(user.id)?.has(peer.id)) return;
      match.connect.add(user.id);
      if (match.connect.size < 2) {
        socket.emit('connect:pending', { matchId });
        peer.socket?.emit('connect:requested', { matchId });
        return;
      }
      const reveal = (to, from) => to.socket?.emit('connect:mutual', {
        matchId, name: from.profile.name, headline: from.profile.headline, contact: from.profile.contact,
      });
      reveal(user, peer);
      reveal(peer, user);
    });

    socket.on('match:report', ({ matchId, reason } = {}) => {
      const found = peerIn(user, matchId);
      if (!found || !found.peer) return;
      const { peer } = found;
      lobby.block(user.id, peer.id);
      peer.reportedBy.add(user.id);
      console.warn(`REPORT match=${matchId} reporter=${user.id} reported=${peer.id} total=${peer.reportedBy.size} reason=${JSON.stringify(String(reason ?? '').slice(0, 200))}`);
      endMatch(matchId, 'reported', user.id);
      if (peer.reportedBy.size >= REPORTS_BEFORE_REMOVAL) {
        peer.removed = true;
        lobby.leave(peer.id);
        peer.socket?.emit('removed');
        peer.socket?.disconnect(true);
      }
    });

    socket.on('disconnect', () => {
      if (user.socket !== socket) return; // Replaced by a newer connection.
      user.socket = null;
      lobby.leave(user.id);
      if (user.matchId) endMatch(user.matchId, 'left', user.id);
      sendStats();
    });
  });

  const matcher = setInterval(() => {
    const pairs = lobby.tick();
    pairs.forEach(startMatch);
    if (pairs.length) sendStats();
  }, tickMs);
  matcher.unref();

  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [token, user] of sessions) {
      if (!user.socket && now - user.createdAt > SESSION_TTL_MS) {
        sessions.delete(token);
        usersById.delete(user.id);
      }
    }
  }, 10 * 60_000);
  sweeper.unref();

  server.on('close', () => {
    clearInterval(matcher);
    clearInterval(sweeper);
    for (const match of matches.values()) clearTimeout(match.timer);
  });

  return { server, io };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  createServer().server.listen(port, () => {
    console.log(`oNetwork running at http://localhost:${port}`);
    console.log(`Resume parser: ${claudeEnabled() ? 'Claude' : 'keywords (set ANTHROPIC_API_KEY to use Claude)'}`);
  });
}
