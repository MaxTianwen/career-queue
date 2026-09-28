import test from 'node:test';
import assert from 'node:assert/strict';
import { discover, SOURCE, officialJob, extractFacts } from '../src/discovery.mjs';
import { evaluateJob } from '../src/core.mjs';

const now = new Date('2026-09-24T16:00:00Z');
const entry = (id, extra = {}) => ({ company_name: 'Synthetic Company', title: 'Software Intern Summer 2027', active: true,
  is_visible: true, terms: ['Summer 2027'], locations: ['Toronto, ON, Canada'], url: `https://job-boards.greenhouse.io/synthetic/jobs/${id}`, date_posted: now.getTime() / 1000, ...extra });
const reply = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });

test('discovery scopes the feed, deduplicates, reads official JD and never substitutes index age for published time', async () => {
  const calls = [];
  const result = await discover({ now, fetchImpl: async url => {
    calls.push(url);
    if (url === SOURCE.dataUrl) return reply([entry(1), entry(1, { url: 'https://boards.greenhouse.io/synthetic/jobs/1/apply?utm_source=test' }), entry(2), entry(3),
      entry(4, { active: false }), entry(5, { locations: ['New York, NY'] }), entry(6, { title: 'Registered Nurse Intern' }), entry(7, { terms: ['Winter 2026'] }),
      entry(8, { url: 'https://127.0.0.1/private' })]);
    const id = Number(url.split('/').at(-1));
    return reply({ id, title: `Software Intern (Summer 2027) Team ${id}`, content: '<p>Official full description.</p>', location: { name: 'Toronto' },
      first_published: id === 1 ? '2026-09-24T15:00:00Z' : id === 2 ? '2026-09-20T10:00:00Z' : null, updated_at: now.toISOString() });
  } });
  assert.equal(result.candidates, 4); assert.equal(result.duplicates, 1); assert.equal(result.skipped, 4);
  assert.equal(result.results.find(x => x.url.endsWith('/1')).sourceLinks.length, 2);
  assert.equal(result.results.filter(x => x.fullJd).length, 3);
  assert.equal(result.results.find(x => x.url.endsWith('/2')).decision, 'REVIEW');
  assert.equal(result.results.find(x => x.url.endsWith('/3')).postedAt, null);
  assert.equal(result.results.find(x => !x.fullJd).decision, 'REVIEW');
  assert.equal(calls.length, 5); assert.ok(!calls.some(x => x.includes('127.0.0.1')));
});

test('one employer failure is visible and does not discard other real results; source failure is not an empty success', async () => {
  const result = await discover({ now, fetchImpl: async url => url === SOURCE.dataUrl ? reply([entry(1), entry(2)]) : url.endsWith('/1') ? new Response('', { status: 429 }) : reply({ id: 2, title: 'Software Intern', content: 'Full JD' }) });
  assert.equal(result.processed, 2);
  assert.match(result.results.find(x => x.fetchError).fetchError, /429/);
  assert.equal(result.results.filter(x => x.fullJd).length, 1);
  await assert.rejects(discover({ fetchImpl: async () => new Response('', { status: 503 }) }), /503/);
  await assert.rejects(discover({ fetchImpl: async () => reply({ changed: true }) }), /格式/);
});

test('ATS requests use only allowlisted hosts and do not follow redirects', async () => {
  for (const url of ['http://jobs.lever.co/site/123', 'https://jobs.lever.co.evil.example/site/00000000-0000-0000-0000-000000000001', 'https://jobs.ashbyhq.com/%2e%2e%2fsecret/00000000-0000-0000-0000-000000000001', 'https://user:pass@jobs.lever.co/site/00000000-0000-0000-0000-000000000001']) {
    assert.equal(await officialJob({ url }, async () => { throw new Error('must not fetch'); }), null);
  }
  const id = '00000000-0000-0000-0000-000000000001';
  const job = await officialJob({ url: `https://jobs.lever.co/site/${id}/apply`, company: 'Example' }, async (url, options) => {
    assert.equal(options.redirect, 'error'); assert.match(url, /^https:\/\/(?:api|jobs).lever.co\//);
    if (url.startsWith('https://jobs.')) return new Response('<script type="application/ld+json">{"@type":"JobPosting","title":"Intern","datePosted":"2026-09-20"}</script>');
    return reply({ id, text: 'Intern', descriptionPlain: 'Opening', lists: [{ text: 'Requirements', content: '<li>SQL</li>' }], additionalPlain: 'Closing', createdAt: now.getTime(), workplaceType: 'hybrid' });
  });
  assert.match(job.jd, /Opening[\s\S]*Requirements[\s\S]*SQL[\s\S]*Closing/);
  assert.equal(job.postedAt, '2026-09-20'); assert.equal(job.workMode, 'hybrid');
});

test('Ashby caches boards, excludes unlisted jobs and keeps republished time separate', async () => {
  const id = '00000000-0000-0000-0000-000000000001'; let count = 0;
  const candidate = { url: `https://jobs.ashbyhq.com/Test%20Board/${id}/application`, company: 'Test' };
  const boards = new Map();
  const fetchImpl = async () => { count++; return reply({ jobs: [{ id, isListed: true, title: 'Intern', descriptionPlain: 'Full JD', publishedAt: now.toISOString(), workplaceType: 'Hybrid', isRemote: true, location: 'Toronto' }] }); };
  const [a, b] = await Promise.all([officialJob(candidate, fetchImpl, boards), officialJob(candidate, fetchImpl, boards)]);
  assert.equal(count, 1); assert.equal(a.workMode, 'hybrid'); assert.equal(b.postedAt, now.toISOString()); assert.equal(b.postedAtKind, 'latest'); assert.equal(a.sourceEvidence.lastPublishedAt, now.toISOString());
  await assert.rejects(officialJob(candidate, async () => reply({ jobs: [{ id, isListed: false }] })), /不再公开/);
});

test('official January start overrides Summer index label; ambiguous duration and pay are not guessed', () => {
  const candidate = { title: 'Software Co-op (January - August 2027)', location: 'Vancouver, Canada', jd: 'Duration: 8 or 12 months', workMode: 'onsite', indexEvidence: { terms: ['Summer 2027'] } };
  const j = extractFacts(candidate);
  assert.equal(j.term, 'Winter 2027'); assert.equal(j.durationMonths, null); assert.equal(j.paid, null); assert.equal(j.inGta, false);
  assert.equal(evaluateJob(j, now).decision, 'REVIEW');
  const may = extractFacts({ ...candidate, title: 'Data Intern', jd: 'Start Date: May 2027\nDuration: 8 months' });
  assert.equal(may.term, 'Summer 2027'); assert.equal(may.durationMonths, 8);
  assert.equal(extractFacts({ ...candidate, title: 'Data Intern', jd: 'We are not an unpaid internship.' }).paid, null);
  const short = extractFacts({ title: 'Software Intern - Summer 2027', location: 'Hub - Toronto', workMode: 'hybrid', jd: 'Join our team for three months in summer 2027.', salary: 'CA$50 per hour' });
  assert.equal(short.durationMonths, 3); assert.equal(short.paid, true);
  assert.ok(evaluateJob(short, now).reasons.includes('GTA 现场 / 混合办公任期须为 4–16 个月'));
  assert.equal(extractFacts({ ...candidate, title: 'Software Intern Summer 2027', jd: '' }).term, 'Unknown');
});

test('Winter-only feed entries are discovered and confirmed January starts are retained', async () => {
  const result = await discover({ now, fetchImpl: async url => url === SOURCE.dataUrl
    ? reply([entry(9, { title: 'Software Co-op', terms: ['Winter 2027'] }), entry(10, { terms: ['Winter 2028'] })])
    : reply({ id: 9, title: 'Software Co-op (January to August 2027)', content: 'Duration: 8 months', location: { name: 'Toronto' }, first_published: now.toISOString() }) });
  assert.equal(result.candidates, 1);
  assert.deepEqual(result.targetTerms, ['Winter 2027', 'Summer 2027', 'Fall 2027']);
  assert.equal(result.results[0].term, 'Winter 2027');
  assert.equal(result.results[0].fullJd, true);
  assert.equal(result.results[0].decision, 'REVIEW');
  assert.ok(!result.results[0].reasons.some(reason => reason.includes('入职批次')));
});
