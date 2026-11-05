import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { extractText, parseResume, parseWithKeywords, ResumeError } from '../server/resume.js';

const read = (path) => readFileSync(new URL(path, import.meta.url));
const claudeProfile = { name: 'Maya Chen', headline: 'Engineer', industries: ['Fintech'], jobs: [], schools: [], skills: [] };
const fakeClient = (response) => ({ beta: { messages: { parse: async (params) => { fakeClient.last = params; return response; } } } });

test('keyword parser pulls jobs, schools, industry and skills', () => {
  const p = parseWithKeywords(read('../samples/maya-chen.txt').toString());
  assert.equal(p.name, 'Maya Chen');
  assert.deepEqual(p.jobs[0], { title: 'Senior Software Engineer', company: 'Stripe' });
  assert.deepEqual(p.jobs[1], { title: 'Software Engineer', company: 'Dropbox' });
  assert.deepEqual(p.schools, [{ name: 'Carnegie Mellon University', field: 'Computer Science' }]);
  assert.ok(p.industries.includes('Software') && p.industries.includes('Fintech'));
  assert.ok(p.skills.includes('Kubernetes'));
});

test('keyword parser handles "Title at Company" and "M.S. in X"', () => {
  const p = parseWithKeywords(read('../samples/liam-okafor.txt').toString());
  assert.deepEqual(p.jobs, [{ title: 'Backend Developer', company: 'Plaid' }]);
  assert.deepEqual(p.schools, [{ name: 'Carnegie Mellon University', field: 'Information Systems' }]);
});

test('keyword parser recognises non-tech resumes', () => {
  const p = parseWithKeywords(read('../samples/ana-rivera.txt').toString());
  assert.equal(p.industries[0], 'Healthcare');
  assert.equal(p.jobs[0].company, 'Mercy General Hospital');
});

test('parsed profile contains no email or phone number', () => {
  const out = JSON.stringify(parseWithKeywords(read('../samples/maya-chen.txt').toString()));
  assert.doesNotMatch(out, /@example|555-/);
});

for (const file of ['maya.pdf', 'maya.docx']) {
  test(`extracts text from ${file}`, async () => {
    const { profile } = await parseResume(read(`./fixtures/${file}`), file);
    assert.equal(profile.name, 'Maya Chen');
    assert.equal(profile.jobs[0].company, 'Stripe');
    assert.equal(profile.schools[0].name, 'Carnegie Mellon University');
  });
}

test('rejects unsupported, corrupt and empty files with a readable error', async () => {
  await assert.rejects(extractText(Buffer.from('x'), 'a.exe'), ResumeError);
  await assert.rejects(extractText(Buffer.from('not a pdf'), 'a.pdf'), ResumeError);
  await assert.rejects(extractText(Buffer.from('hi'), 'a.txt'), /No readable text/);
});

test('uses Claude when available and marks resume text as data', async () => {
  const client = fakeClient({ stop_reason: 'end_turn', parsed_output: claudeProfile });
  const { profile, parser } = await parseResume(read('../samples/maya-chen.txt'), 'a.txt', { client });
  assert.equal(parser, 'claude');
  assert.equal(profile.industries[0], 'Fintech');
  assert.equal(fakeClient.last.model, 'claude-opus-5-5');
  assert.match(fakeClient.last.messages[0].content, /^<resume>/);
});

test('falls back to keywords when Claude refuses or errors', async () => {
  const refused = await parseResume(read('../samples/maya-chen.txt'), 'a.txt', { client: fakeClient({ stop_reason: 'refusal', parsed_output: null }) });
  assert.equal(refused.parser, 'keywords');
  const broken = { beta: { messages: { parse: async () => { throw new Error('boom'); } } } };
  const errored = await parseResume(read('../samples/maya-chen.txt'), 'a.txt', { client: broken });
  assert.equal(errored.parser, 'keywords');
  assert.equal(errored.profile.name, 'Maya Chen');
});
