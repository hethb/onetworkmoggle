import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Lobby } from '../server/lobby.js';
import { scoreMatch, thresholdFor } from '../server/matching.js';

const person = (industries, extra = {}) => ({ industries, jobs: [], schools: [], skills: [], ...extra });
const fintech = person(['Fintech', 'Software'], {
  jobs: [{ title: 'Software Engineer', company: 'Stripe Inc' }],
  schools: [{ name: 'Carnegie Mellon University', field: 'CS' }],
  skills: ['Go', 'Kubernetes'],
});
const fintech2 = person(['Fintech'], {
  jobs: [{ title: 'Senior Software Engineer', company: 'stripe' }],
  schools: [{ name: 'carnegie mellon university', field: 'Math' }],
  skills: ['go'],
});
const banker = person(['Banking & Finance']);
const nurse = person(['Healthcare']);

test('same field, school and company scores high and explains why', () => {
  const { score, reasons } = scoreMatch(fintech, fintech2);
  assert.ok(score >= 80, `score was ${score}`);
  assert.ok(reasons.includes('Both in Fintech'));
  assert.ok(reasons.includes('Both went to Carnegie Mellon University'));
  assert.ok(reasons.some((r) => r.startsWith('Both worked at')));
});

test('ranks same field above related field above unrelated', () => {
  const same = scoreMatch(fintech, fintech2).score;
  const related = scoreMatch(fintech, banker).score;
  const unrelated = scoreMatch(fintech, nurse).score;
  assert.ok(same > related && related > unrelated, `${same} ${related} ${unrelated}`);
  assert.equal(unrelated, 0);
});

test('scoring is symmetric', () => {
  assert.equal(scoreMatch(fintech, fintech2).score, scoreMatch(fintech2, fintech).score);
});

test('threshold relaxes with waiting time', () => {
  assert.ok(thresholdFor(0) > thresholdFor(20_000));
  assert.ok(thresholdFor(20_000) > thresholdFor(60_000));
  assert.equal(thresholdFor(60_000), 0);
});

test('lobby prefers the best match over who arrived first', () => {
  const lobby = new Lobby();
  lobby.join('banker', banker, 0);
  lobby.join('a', fintech, 0);
  lobby.join('b', fintech2, 0);
  const pairs = lobby.tick(1000);
  assert.equal(pairs.length, 1);
  assert.deepEqual([pairs[0].a, pairs[0].b].sort(), ['a', 'b']);
  assert.ok(lobby.waiting.has('banker'));
});

test('unrelated people wait, then pair once both have waited long enough', () => {
  const lobby = new Lobby();
  lobby.join('a', fintech, 0);
  lobby.join('b', nurse, 0);
  assert.equal(lobby.tick(1000).length, 0);
  assert.equal(lobby.tick(30_000).length, 0);
  assert.equal(lobby.tick(60_000).length, 1);
});

test('a newcomer is not forced into a poor match by someone else waiting', () => {
  const lobby = new Lobby();
  lobby.join('a', fintech, 0);
  lobby.join('b', nurse, 100_000);
  assert.equal(lobby.tick(101_000).length, 0);
});

test('nobody appears in two pairs', () => {
  const lobby = new Lobby();
  ['a', 'b', 'c', 'd', 'e'].forEach((id) => lobby.join(id, fintech, 0));
  const ids = lobby.tick(1000).flatMap((p) => [p.a, p.b]);
  assert.equal(ids.length, 4);
  assert.equal(new Set(ids).size, 4);
  assert.equal(lobby.waiting.size, 1);
});

test('blocked pairs never rematch; recent pairs wait', () => {
  const lobby = new Lobby();
  lobby.block('a', 'b');
  lobby.join('a', fintech, 0);
  lobby.join('b', fintech, 0);
  assert.equal(lobby.tick(10_000_000).length, 0);

  const other = new Lobby();
  other.remember('a', 'b', 0);
  other.join('a', fintech, 0);
  other.join('b', fintech, 0);
  assert.equal(other.tick(1000).length, 0);
  assert.equal(other.tick(120_000).length, 1);
});
