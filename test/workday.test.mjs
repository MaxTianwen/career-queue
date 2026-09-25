import test from 'node:test';
import assert from 'node:assert/strict';
import { workdayUrl, parseWorkday, fetchWorkday } from '../src/workday.mjs';
import { discover, SOURCE, extractFacts } from '../src/discovery.mjs';
import { normalizeJob } from '../src/core.mjs';
import { mergeDiscoveryJobs } from '../src/discovery-records.mjs';
import { deadlineExpired } from '../src/deadlines.mjs';

const candidate = { company: 'Synthetic', title: 'Index summary', location: 'Canada', url: 'https://synthetic.wd3.myworkdayjobs.com/en-US/Careers/job/Toronto/Software-Intern_R_123-2?source=index' };
const post = { '@type': 'JobPosting', title: 'Software &amp; Data Intern Summer 2027', identifier: { value: 'R_123' },
  description: '<p>Qualifications</p><ul><li>Python &amp; SQL</li><li>Duration: 4 months</li></ul><p>#LI-Hybrid</p>',
  jobLocation: [{ address: { addressLocality: 'Toronto', addressRegion: 'Ontario', addressCountry: { name: 'Canada' } } }, { address: { addressLocality: 'Markham', addressCountry: 'Canada' } }],
  datePosted: '2026-09-20', validThrough: '2026-10-01', jobLocationType: 'TELECOMMUTE',
  baseSalary: { currency: 'CAD', value: { minValue: 25, maxValue: 30, unitText: 'HOUR' } } };
const html = data => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;

test('Workday reads the matching public JobPosting, retains dates/locations/pay and decodes JD text', async () => {
  let calls = 0;
  const job = await fetchWorkday(candidate, async (url, options) => {
    calls++; assert.equal(url, candidate.url.split('?')[0]); assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.Authorization, undefined);
    return new Response(html({ '@graph': [{ ...post, identifier: { value: 'OTHER' } }, post] }));
  });
  assert.equal(calls, 1); assert.equal(job.title, 'Software & Data Intern Summer 2027');
  assert.match(job.jd, /Qualifications\nPython & SQL\nDuration: 4 months/);
  assert.equal(job.location, 'Toronto, Ontario, Canada / Markham, Canada');
  assert.equal(job.requisitionId, 'R_123'); assert.equal(job.salary, 'CAD 25–30 / hour');
  assert.equal(job.workMode, 'hybrid'); assert.equal(job.postedAt, post.datePosted);
  assert.equal(job.deadline, post.validThrough); assert.equal(job.sourceEvidence.postedAtField, 'JobPosting.datePosted');
});

test('locale and apply links stay restricted to public Workday detail paths', () => {
  assert.equal(workdayUrl(candidate.url.replace('?source=index', '/apply')).url, candidate.url.split('?')[0]);
  assert.equal(workdayUrl(candidate.url.replace('/en-US', '')).slug, 'Software-Intern_R_123-2');
  for (const url of ['https://127.0.0.1/Careers/job/Intern_R_123', candidate.url.replace('https:', 'http:'),
    candidate.url.replace('.com/', '.com.evil.example/'), candidate.url.replace('https://', 'https://user:secret@'),
    candidate.url.replace('.com/', '.com:8443/'), candidate.url.replace('/Careers/job/', '/Careers/login/'),
    candidate.url.replace('/Toronto/', '/%2fprivate/'), candidate.url.replace('/en-US/Careers/job/', '/wday/cxs/synthetic/Careers/job/')]) {
    assert.throws(() => workdayUrl(url));
  }
});

test('untrusted URLs never trigger a Workday request; redirects and HTTP failures stay errors', async () => {
  let calls = 0;
  await assert.rejects(fetchWorkday({ ...candidate, url: 'https://example.com/private' }, async () => { calls++; }));
  assert.equal(calls, 0);
  for (const status of [302, 403, 404, 410, 429, 500]) {
    await assert.rejects(fetchWorkday(candidate, async () => new Response('', { status })), new RegExp(`HTTP ${status}`));
  }
  await assert.rejects(fetchWorkday(candidate, async () => { throw new Error('timeout'); }), /timeout/);
  await assert.rejects(fetchWorkday(candidate, async () => new Response('x'.repeat(2_000_001))), /大小限制/);
});

test('wrong requisitions, malformed metadata, login shells, empty descriptions and conflicting posts cannot become full JD', () => {
  for (const page of ['<html>Login required</html>', '<script type="application/ld+json">invalid</script>',
    html({ ...post, identifier: { value: 'WRONG' } }), html({ ...post, identifier: undefined }),
    html({ ...post, description: '<p> </p>' }), html([post, { ...post, description: 'Different job content' }])]) {
    assert.throws(() => parseWorkday(page, candidate));
  }
  assert.equal(parseWorkday(html([post, post]), candidate).requisitionId, 'R_123');
});

test('relative/invalid dates and TELECOMMUTE never become guessed dates or full remote', () => {
  const job = parseWorkday(html({ ...post, datePosted: 'Posted 2 days ago', validThrough: '2026-02-30',
    description: 'Python. Our team works in a hybrid model.', baseSalary: { currency: 'CAD', value: { value: 30 } } }), candidate);
  assert.equal(job.postedAt, null); assert.equal(job.deadline, null); assert.equal(job.workMode, 'unknown');
  assert.equal(job.salary, '未披露'); assert.equal(job.sourceEvidence.jobLocationType, 'TELECOMMUTE');
  assert.equal(parseWorkday(html({ ...post, description: '#LI-Remote #LI-Hybrid' }), candidate).workMode, 'unknown');
});

test('official Workday start-title variants override index seasons, without inferring a season from year alone', () => {
  for (const [title, term] of [['Summer Intern 2027 - Software Engineering', 'Summer 2027'],
    ['Winter Co-op 2027 - Reporting Analyst', 'Winter 2027'], ['2027 Winter Co-op Developer', 'Winter 2027'],
    ['Developer (January 2027)', 'Winter 2027'], ['Intern 2027', 'Unknown']]) {
    const input = { ...candidate, title, jd: 'Full description', indexEvidence: { terms: ['Fall 2027'] } };
    assert.equal(extractFacts(input).term, term);
    assert.equal(extractFacts({ ...input, jd: '' }).term, 'Unknown');
  }
});

test('new Workday results share Queue identity with older URL-based saved records through pipeline URL matching', async () => {
  const { ingest } = await import('../src/pipeline.mjs');
  const { DemoStore } = await import('../src/demo-store.mjs');
  const old = normalizeJob({ ...candidate, jd: 'Previously pasted full description', term: 'Summer 2027' });
  const store = new DemoStore();
  await ingest(store, [old]);
  const job = normalizeJob({ ...parseWorkday(html(post), candidate), term: 'Summer 2027' });
  const result = await ingest(store, [job]);
  assert.equal(result.inserted.length, 0); assert.equal(result.duplicates[0], old.key);
});

test('verified Workday requisitions deduplicate locale links while conflicting locations remain separate', () => {
  const a = normalizeJob({ ...parseWorkday(html(post), candidate), term: 'Summer 2027' });
  const b = normalizeJob({ ...a, url: a.url.replace('/en-US/', '/en-CA/') });
  assert.equal(mergeDiscoveryJobs([a, b]).duplicates, 1);
  assert.ok(mergeDiscoveryJobs([a, { ...b, location: 'Ottawa' }]).results.every(j => j.identityConflict));
});

test('discovery integrates Workday full JD, dates and failures without replacing index timestamps', async () => {
  const entry = (url, title = 'Software Intern') => ({ company_name: 'Synthetic', title, url, terms: ['Summer 2027'], locations: ['Toronto, Canada'], active: true, is_visible: true, date_posted: 1790000000 });
  const report = await discover({ now: new Date('2026-09-25T16:00:00Z'), fetchImpl: async url => {
    if (url === SOURCE.dataUrl) return new Response(JSON.stringify([entry(candidate.url), entry(candidate.url.replace('R_123-2', 'R_404'))]));
    if (url.endsWith('R_404')) return new Response('', { status: 404 });
    return new Response(html({ ...post, validThrough: '2026-09-24' }));
  } });
  const success = report.results.find(j => j.fullJd), failure = report.results.find(j => !j.fullJd);
  assert.equal(success.term, 'Summer 2027'); assert.equal(success.durationMonths, 4);
  assert.equal(success.postedAt, '2026-09-20'); assert.equal(success.decision, 'REJECT');
  assert.equal(deadlineExpired(success.deadline, new Date('2026-09-25T16:00:00Z')), true);
  assert.match(failure.fetchError, /404/); assert.equal(failure.postedAt, null);
  assert.equal(report.coverage.find(row => row.name === 'Workday').failed, 1);
  assert.equal(report.dataVersion, 4);
});
