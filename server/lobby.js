import { randomUUID } from 'node:crypto';
import { scoreMatch, thresholdFor } from './matching.js';

const RECENT_MS = 2 * 60_000;

// The waiting queue plus who should not be paired again. Time is passed in
// so that matching can be tested without timers.
export class Lobby {
  constructor(options = {}) {
    this.options = options;
    this.waiting = new Map(); // userId -> { profile, since }
    this.blocks = new Map(); // userId -> Set<userId>
    this.recent = new Map(); // "a|b" -> timestamp
  }

  join(userId, profile, now = Date.now()) {
    this.waiting.set(userId, { profile, since: now });
  }

  leave(userId) {
    this.waiting.delete(userId);
  }

  block(a, b) {
    for (const [from, to] of [[a, b], [b, a]]) {
      if (!this.blocks.has(from)) this.blocks.set(from, new Set());
      this.blocks.get(from).add(to);
    }
  }

  remember(a, b, now = Date.now()) {
    this.recent.set([a, b].sort().join('|'), now);
  }

  canPair(a, b, now) {
    if (this.blocks.get(a)?.has(b)) return false;
    const met = this.recent.get([a, b].sort().join('|'));
    return met === undefined || now - met >= RECENT_MS;
  }

  // Returns the pairs to start now, best match first, and removes them from the queue.
  tick(now = Date.now()) {
    for (const [key, at] of this.recent) {
      if (now - at >= RECENT_MS) this.recent.delete(key);
    }

    const entries = [...this.waiting.entries()];
    const candidates = [];
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const [a, ea] = entries[i];
        const [b, eb] = entries[j];
        if (!this.canPair(a, b, now)) continue;
        const { score, reasons } = scoreMatch(ea.profile, eb.profile);
        // Both people must be willing to accept this score.
        const waited = now - Math.max(ea.since, eb.since);
        if (score >= thresholdFor(waited, this.options)) candidates.push({ a, b, score, reasons });
      }
    }

    candidates.sort((x, y) => y.score - x.score);
    const pairs = [];
    for (const pair of candidates) {
      if (!this.waiting.has(pair.a) || !this.waiting.has(pair.b)) continue;
      this.waiting.delete(pair.a);
      this.waiting.delete(pair.b);
      pairs.push({ ...pair, matchId: randomUUID() });
    }
    return pairs;
  }
}
