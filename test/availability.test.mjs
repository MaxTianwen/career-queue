import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAvailability } from '../src/availability.mjs';

const now = new Date('2026-09-29T16:00:00Z');
const jd = 'Build software with Python and SQL. Collaborate with the product team to test reliable tools and document the results.';
const id = '12345678-1234-1234-1234-123456789abc';
const candidate = { company: 'Synthetic', title: 'Software Intern', url: 'https://synthetic.wd3.myworkdayjobs.com/en-US/Careers/job/Toronto/Intern_R123', jd: 'Old description', status: '待提交' };
const post = { '@type': 'JobPosting', identifier: { value: 'R123' }, title: 'Software Intern', description: jd, validThrough: '2026-10-01' };
const page = (value = post) => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

test('availability reuses all four public readers and returns fresh identity-checked JD with check time', async () => {
  for (const ats of ['workday', 'greenhouse', 'lever', 'ashby']) {
    const urls = { workday: candidate.url, greenhouse: 'https://boards.greenhouse.io/synthetic/jobs/123', lever: `https://jobs.lever.co/synthetic/${id}/apply`, ashby: `https://jobs.ashbyhq.com/synthetic/${id}` };
    const calls = [];
    const checked = await checkAvailability({ ...candidate, url: urls[ats] }, { now, fetchImpl: async (url, options) => {
      calls.push(url); assert.equal(options.redirect, 'manual');
      if (url.includes('myworkdayjobs')) return new Response(page());
      if (url.includes('boards-api')) return json({ id: 123, title: 'Software Intern', content: jd, first_published: '2026-09-01' });
      if (url.includes('api.lever')) return json({ id, text: 'Software Intern', descriptionPlain: jd });
      if (url.includes('api.ashby')) return json({ jobs: [{ id, title: 'Software Intern', descriptionPlain: jd, isListed: true }] });
      return new Response(page());
    } });
    assert.equal(checked.status, 'open', ats); assert.equal(checked.checkedAt, now.toISOString());
    assert.equal(checked.job.jd, jd); assert.equal(checked.job.status, '待提交'); assert.ok(calls.length);
  }
});

test('expired deadlines close without fetching; Toronto date-only deadline remains open throughout its day', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return new Response(page({ ...post, validThrough: '2026-09-29' })); };
  assert.equal((await checkAvailability({ ...candidate, deadline: '2026-09-28' }, { now, fetchImpl })).status, 'closed');
  assert.equal(calls, 0);
  assert.equal((await checkAvailability(candidate, { now: new Date('2026-09-30T03:59:59Z'), fetchImpl })).status, 'open');
  const checked = await checkAvailability(candidate, { now: new Date('2026-09-30T04:00:00Z'), fetchImpl });
  assert.equal(checked.status, 'closed'); assert.equal(checked.job.deadline, '2026-09-29');
});

test('short bodies, maintenance, HTTP errors and timeouts remain unknown, retaining the input unchanged', async () => {
  const before = structuredClone(candidate);
  const responses = [() => new Response('Maintenance'), () => new Response(page({ ...post, description: 'Python' })),
    ...[302, 403, 404, 410, 429, 500].map(status => () => new Response('<h1>This job is no longer available</h1>', { status })),
    () => { throw new Error('timeout'); }, () => new Response('x'.repeat(2_000_001))];
  for (const fetchImpl of responses) assert.equal((await checkAvailability(candidate, { now, fetchImpl })).status, 'unknown');
  assert.deepEqual(candidate, before);
});

test('only explicit official closure headings close a job; prose, scripts and conflicting live metadata do not', async () => {
  const closed = '<h1>Sorry, this job is no longer available.</h1>';
  const check = html => checkAvailability(candidate, { now, fetchImpl: async () => new Response(html) });
  const verified = await check(closed);
  assert.equal(verified.status, 'closed'); assert.match(verified.evidence, /no longer available/);
  for (const html of ['<p>Our blog: applications closed last summer.</p>', '<p>This job is no longer available.</p>',
    '<script>"<h1>This job is no longer available</h1>"</script>', `<!--${closed}-->`, `<template>${closed}</template>`,
    '<h1 hidden>This job is no longer available</h1>', '<h1 aria-hidden="true">This job is no longer available</h1>', page() + closed]) assert.equal((await check(html)).status, 'unknown');
  assert.equal((await check(page({ ...post, description: jd + ' Our former internship applications closed last summer.' }))).status, 'open');
});

test('a missing API listing is unknown unless its official job page explicitly confirms closure', async () => {
  const job = { ...candidate, url: `https://jobs.ashbyhq.com/synthetic/${id}` };
  for (const isListed of [false, undefined]) {
    const checked = await checkAvailability(job, { now, fetchImpl: async url => url.includes('api.ashby')
      ? json({ jobs: isListed === undefined ? [] : [{ id, isListed, descriptionPlain: jd, title: job.title }] }) : new Response('<h1>Careers</h1>') });
    assert.equal(checked.status, 'unknown');
  }
  const checked = await checkAvailability(job, { now, fetchImpl: async url => url.includes('api.ashby')
    ? json({ jobs: [] }) : new Response('<h2>Applications for this position are now closed.</h2>') });
  assert.equal(checked.status, 'closed');
});

test('unapproved URLs never fetch; redirected or wrong-identity responses cannot claim availability', async () => {
  let calls = 0;
  for (const url of ['http://127.0.0.1/private', 'https://example.com/jobs/123', 'https://user:secret@jobs.lever.co/synthetic/' + id,
    candidate.url.replace('.com/', '.com.evil.example/'), candidate.url.replace('.com/', '.com:8443/'),
    candidate.url.replace('/Toronto/', '/%2fprivate/'), 'https://jobs.ashbyhq.com/synthetic/../../admin', 'not a url']) {
    assert.equal((await checkAvailability({ ...candidate, url }, { now, fetchImpl: async () => { calls++; } })).status, 'unknown');
  }
  assert.equal(calls, 0);
  assert.equal((await checkAvailability(candidate, { now, fetchImpl: async () => new Response(page({ ...post, identifier: { value: 'OTHER' } })) })).status, 'unknown');
  const redirected = new Response(page()); Object.defineProperty(redirected, 'redirected', { value: true });
  assert.equal((await checkAvailability(candidate, { now, fetchImpl: async () => redirected })).status, 'unknown');
});
