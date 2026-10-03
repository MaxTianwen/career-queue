import test from 'node:test';
import assert from 'node:assert/strict';
import { officialJob } from '../src/discovery.mjs';
import { checkAvailability } from '../src/availability.mjs';
import { schoolCandidate, completeSchoolCandidate } from '../src/school-candidates.mjs';
import { fetchVeevaPage } from '../src/veeva-page.mjs';

const id = '85fe3393-f296-4463-88a2-5454c6ba334b';
const url = `https://jobs.lever.co/veeva/${id}`;
const title = 'Intern Software Engineer - Toronto [12 - 16 Months]';
const job = { company: 'Veeva Systems', title, url, location: 'Toronto', term: 'Summer 2027' };
const post = { '@type': 'JobPosting', title, hiringOrganization: { name: 'Veeva Systems' },
  description: '<p>Build software with Python and Java, write automated tests and collaborate with the team.</p><ul><li>Ability to complete a 12-16 month internship</li></ul>',
  jobLocation: { address: { addressLocality: 'Canada - Toronto' } }, datePosted: '2026-08-13' };
const page = (p = post, link = `${url}/apply`) => `<h2>${title}</h2><div class="posting-category workplaceTypes">On-site</div><a href="${link}">Apply</a><script type="application/ld+json">${JSON.stringify(p)}</script>`;
const mock = (html = page(), status = 404) => async u => u.includes('api.lever.co') ? new Response('{}', { status }) : new Response(html);

test('Veeva linked page provides JD when the public API omits the posting', async () => {
  const calls = [];
  const result = await officialJob(job, async (u, options) => { calls.push(u); assert.equal(options.redirect, 'error'); return mock()(u); });
  assert.equal(calls.length, 2); assert.equal(calls[1], url);
  assert.equal(result.requisitionId, id); assert.equal(result.postedAt, '2026-08-13');
  assert.equal(result.workMode, 'onsite'); assert.equal(result.location, 'Canada - Toronto');
  assert.match(result.jd, /• Ability to complete/); assert.match(result.sourceEvidence.note, /API 返回 404/);
  assert.equal(result.deadline, null);
});

test('API omissions are not closure proof; verified page can reopen availability while conflicts remain unknown', async () => {
  const now = new Date('2026-10-03T16:00:00Z');
  assert.equal((await checkAvailability(job, { fetchImpl: mock(), now })).status, 'open');
  assert.equal((await checkAvailability(job, { fetchImpl: mock(page() + '<h1>This job is no longer available</h1>'), now })).status, 'unknown');
  assert.equal((await checkAvailability(job, { fetchImpl: mock('<h1>This job is no longer available</h1>'), now })).status, 'closed');
  assert.equal((await checkAvailability(job, { fetchImpl: mock('<h1>Maintenance</h1>'), now })).status, 'unknown');
});

test('Veeva fallback cannot accept another posting, organization, or unverified metadata', async () => {
  for (const html of [page(post, url.replace(id, '12345678-1234-1234-1234-123456789abc') + '/apply'),
    page({ ...post, title: 'Another posting' }), page({ ...post, hiringOrganization: { name: 'Another employer' } }),
    page({ ...post, description: 'Short' }), page() + page(), '<script>' + JSON.stringify(page()) + '</script>',
    page().replace(/<a[^>]*>Apply<\/a>/, '')]) {
    await assert.rejects(officialJob(job, mock(html)), /核实|完整 JD/);
  }
});

test('fallback is bounded to Veeva 404 and rejects redirection, oversized pages and non-allowlisted URLs', async () => {
  for (const status of [403, 429, 500]) {
    let calls = 0;
    await assert.rejects(officialJob(job, async u => { calls++; return mock(page(), status)(u); }));
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(officialJob({ ...job, url: url.replace('/veeva/', '/other/') }, async () => { calls++; return new Response('{}', { status: 404 }); }));
  assert.equal(calls, 1);
  for (const bad of ['http://127.0.0.1/private', url.replace('lever.co', 'lever.co.evil.test'), url.replace('https://', 'https://user:pass@'), url.replace('lever.co', 'lever.co:8443')]) {
    await assert.rejects(fetchVeevaPage({ ...job, url: bad }, async () => { throw Error('must not fetch'); }), /不支持/);
  }
  await assert.rejects(officialJob(job, mock('x'.repeat(2_000_001))), /大小限制/);
  await assert.rejects(officialJob(job, async u => u.includes('api.lever') ? new Response('{}', { status: 404 }) : new Response('', { status: 302, headers: { Location: 'https://example.com' } })), /读取失败/);
});

test('school completion using linked Veeva page preserves school term, deadline, notes and identity', async () => {
  const record = { ...schoolCandidate({ ...job, id: '116186', externalUrl: url, deadline: '2026-10-25' }, []), notes: 'Keep these notes' };
  const details = await officialJob(job, mock());
  const complete = completeSchoolCandidate(record, details, [record]);
  assert.equal(complete.key, record.key); assert.deepEqual(complete.portal, record.portal);
  assert.equal(complete.notes, record.notes); assert.equal(complete.applicationDate, null);
  assert.equal(complete.term, 'Summer 2027'); assert.equal(complete.deadline, null);
  assert.equal(complete.fullJd, true); assert.equal(complete.schoolCandidate, false);
});
