import { areAdjacent } from './taxonomy.js';

const STOPWORDS = new Set(['senior', 'junior', 'staff', 'lead', 'principal', 'associate', 'assistant', 'intern', 'of', 'and', 'the', 'at', 'for', 'ii', 'iii', 'sr', 'jr']);

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\b(the|inc|llc|ltd|corp|corporation)\b/g, '').replace(/\s+/g, ' ').trim();

function shared(a, b, key = (x) => x) {
  const seen = new Map(a.map((x) => [norm(key(x)), key(x)]));
  const out = [];
  for (const item of b) {
    const k = norm(key(item));
    if (k && seen.has(k)) out.push(seen.get(k));
  }
  return [...new Set(out)];
}

function titleWords(profile) {
  const words = profile.jobs.flatMap((j) => norm(j.title).split(' '));
  return words.filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

// Score how useful a conversation between two people is likely to be (0–100),
// and say why, so both people have something to open with.
export function scoreMatch(a, b) {
  let score = 0;
  const reasons = [];

  const sameIndustries = a.industries.filter((i) => b.industries.includes(i));
  if (sameIndustries.length) {
    // The first listed industry is each person's main one.
    score += a.industries[0] === b.industries[0] ? 50 : 35;
    score += Math.min(sameIndustries.length - 1, 2) * 5;
    reasons.push(`Both in ${sameIndustries.join(' & ')}`);
  } else {
    const pair = a.industries.flatMap((x) => b.industries.filter((y) => areAdjacent(x, y)).map((y) => [x, y]))[0];
    if (pair) {
      score += 20;
      reasons.push(`Related fields: ${pair[0]} and ${pair[1]}`);
    }
  }

  const schools = shared(a.schools, b.schools, (s) => s.name);
  if (schools.length) {
    score += 15;
    reasons.push(`Both went to ${schools[0]}`);
  }

  const fields = shared(a.schools.filter((s) => s.field), b.schools.filter((s) => s.field), (s) => s.field);
  if (fields.length) {
    score += 5;
    if (!schools.length) reasons.push(`Both studied ${fields[0]}`);
  }

  const companies = shared(a.jobs.filter((j) => j.company), b.jobs.filter((j) => j.company), (j) => j.company);
  if (companies.length) {
    score += 15;
    reasons.push(`Both worked at ${companies[0]}`);
  }

  const wordsB = new Set(titleWords(b));
  const titleOverlap = new Set(titleWords(a).filter((w) => wordsB.has(w))).size;
  score += Math.min(titleOverlap * 5, 10);

  const skills = shared(a.skills, b.skills);
  if (skills.length) {
    score += Math.min(skills.length * 2, 10);
    reasons.push(`Shared skills: ${skills.slice(0, 3).join(', ')}`);
  }

  return { score: Math.min(score, 100), reasons };
}

// Start picky, then relax as someone waits: a good match is worth a few seconds,
// but an empty queue is worse than a wider conversation.
export function thresholdFor(waitedMs, { strictMs = 15_000, widerMs = 60_000 } = {}) {
  if (waitedMs < strictMs) return 50;
  if (waitedMs < widerMs) return 20;
  return 0;
}
