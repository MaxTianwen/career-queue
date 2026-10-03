import test from 'node:test';
import assert from 'node:assert/strict';
import { qualcommUrl, qualcommPosting, qualcommSearchUrl, qualcommDetailUrl, fetchQualcomm } from '../src/qualcomm.mjs';
import { EMPLOYER_SOURCES, readEmployerBoard } from '../src/discovery-sources.mjs';
import { discover, SOURCE } from '../src/discovery.mjs';
import { postingUrl, sourceName } from '../src/discovery-records.mjs';
import { checkAvailability } from '../src/availability.mjs';
import { portalDiscovery } from '../src/portal.mjs';

const source = EMPLOYER_SOURCES.find(s => s.id === 'qualcomm');
const item = (id = 446721229661, extra = {}) => ({ id, displayJobId: '3097052', atsJobId: '3097052', name: 'FY27 Intern - PAL Firmware Development Internship - Canada (16 months)',
  positionUrl: `/careers/job/${id}`, publicUrl: `https://careers.qualcomm.com/careers/job/${id}`, locations: ['Markham, Ontario, Canada'],
  postedTs: 1789603200, creationTs: 1789084800, workLocationOption: 'onsite', jobDescription: '<h2>Responsibilities</h2><p>Develop firmware and test software with Python and C++.</p><h2>Requirements</h2><p>Experience with SQL and software development. For 16-month internships: must be available May/June 2027.</p>', ...extra });
const response = (data, extra = {}) => new Response(JSON.stringify({ status: 200, error: { message: '', body: '' }, data, ...extra }));
const list = (positions, count = positions.length) => response({ positions, count });

test('Qualcomm canonical URLs cover verified alias and reject foreign hosts or non-job paths', () => {
  const url = item().publicUrl;
  assert.equal(qualcommUrl(url + '/?source=school#x'), url);
  assert.equal(postingUrl(url.replace('careers.qualcomm.com', 'qualcomm.eightfold.ai')), url);
  assert.equal(sourceName({ url }), 'Qualcomm / Eightfold');
  for (const value of ['http://careers.qualcomm.com/careers/job/1', 'https://x@careers.qualcomm.com/careers/job/1', 'https://careers.qualcomm.com:99/careers/job/1', 'https://careers.qualcomm.com.evil.test/careers/job/1', 'https://other.eightfold.ai/careers/job/1', url + '/apply', 'https://careers.qualcomm.com/careers?pid=1']) assert.equal(qualcommUrl(value), null);
});

test('Qualcomm keeps employer and page IDs distinct, full JD and actual publication date', () => {
  const parsed = qualcommPosting(item(), 'api', true);
  assert.equal(parsed.requisitionId, '3097052'); assert.match(parsed.url, /446721229661$/);
  assert.match(parsed.jd, /Responsibilities[\s\S]*Requirements/); assert.doesNotMatch(parsed.jd, /<p>/);
  assert.equal(parsed.postedAt, '2026-09-17'); assert.equal(parsed.postedAtKind, 'official');
  assert.equal(parsed.workMode, 'onsite'); assert.equal(parsed.deadline, null); assert.equal(parsed.salary, '未披露');
  for (const postedTs of [null, '1789603200', NaN, 1789603200000]) assert.equal(qualcommPosting(item(1, { postedTs }), 'api').postedAt, null);
  assert.equal(qualcommPosting(item(1, { workLocationOption: 'flexible' }), 'api').workMode, 'unknown');
  for (const bad of [{ atsJobId: '9' }, { displayJobId: '' }, { id: 9 }, { positionUrl: '//evil.test/careers/job/1' }, { locations: [] }]) assert.throws(() => qualcommPosting(item(undefined, bad), 'api'));
  for (const bad of [{ jobDescription: '' }, { publicUrl: item(99).publicUrl }]) assert.throws(() => qualcommPosting(item(undefined, bad), 'api', true));
});

test('Qualcomm paginates fixed Canadian queries and deduplicates cross-query page IDs', async () => {
  const calls = [];
  const result = await readEmployerBoard(source, async (url, options) => {
    calls.push(url); assert.equal(options.redirect, 'error');
    const u = new URL(url); assert.equal(u.hostname, 'careers.qualcomm.com'); assert.equal(u.searchParams.get('location'), 'Canada');
    if (u.searchParams.get('query') === 'co-op') return list([item(1)]);
    return u.searchParams.get('start') === '0' ? list(Array.from({ length: 10 }, (_, i) => item(i + 1)), 11) : list([item(11)], 11);
  });
  assert.equal(result.status, 'complete'); assert.equal(result.raw, 12); assert.equal(result.jobs.length, 11); assert.equal(result.pages, 3);
  assert.equal(calls[1], qualcommSearchUrl('intern', 10));
  await assert.rejects(readEmployerBoard({ ...source, board: 'other' }, async () => assert.fail()));
  assert.equal((await readEmployerBoard(source, async () => list([]))).status, 'complete');
});

test('Qualcomm preserves partial lists and flags malformed, duplicate, geographic and pagination failures', async () => {
  const result = await readEmployerBoard(source, async url => url.includes('co-op') ? new Response('', { status: 503 }) : list([item()]));
  assert.equal(result.status, 'partial'); assert.equal(result.jobs.length, 1);
  for (const fetchImpl of [async () => list([item()], 11), async () => list([item(), item()]), async () => list([item(1, { locations: ['San Diego, US'] })]), async () => response({ positions: [], count: '1' }), async () => new Response('invalid'), async () => new Response('', { status: 429 })]) assert.notEqual((await readEmployerBoard(source, fetchImpl)).status, 'complete');
  let calls = 0;
  const changing = await readEmployerBoard(source, async () => list(Array.from({ length: 10 }, (_, i) => item(i + calls * 10 + 1)), calls++ ? 22 : 21));
  assert.equal(changing.status, 'partial'); assert.match(changing.error, /总数变化/);
});

test('Qualcomm enforces bounded pagination without claiming complete coverage', async () => {
  let calls = 0;
  const result = await readEmployerBoard(source, async () => { const page = calls++; return list(Array.from({ length: 10 }, (_, i) => item(i + page * 10 + 1)), 201); });
  assert.equal(result.status, 'partial'); assert.equal(result.pages, 20); assert.equal(result.jobs.length, 200);
});

test('Qualcomm exact detail rechecks reject different IDs, fallback and failed content without marking closed', async () => {
  const candidate = { url: item().publicUrl, requisitionId: '3097052' };
  const open = await checkAvailability(candidate, { fetchImpl: async url => { assert.equal(url, qualcommDetailUrl('446721229661')); return response(item()); } });
  assert.equal(open.status, 'open'); assert.match(open.job.jd, /firmware/);
  for (const data of [item(99), item(undefined, { displayJobId: '99', atsJobId: '99' }), item(undefined, { jobDescription: '' }), null]) {
    const result = await checkAvailability(candidate, { fetchImpl: async url => url.includes('/api/') ? response(data) : new Response('<h1>Unavailable</h1>') });
    assert.equal(result.status, 'unknown');
  }
  await assert.rejects(fetchQualcomm(candidate, async () => response(item(), { metadata: { isFallback: true } })));
  for (const status of [403, 429, 503]) assert.equal((await checkAvailability(candidate, { fetchImpl: async () => new Response('', { status }) })).status, 'unknown');
  await assert.rejects(fetchQualcomm({ url: 'https://evil.test/careers/job/1' }, async () => assert.fail()));
  assert.equal((await checkAvailability(candidate, { fetchImpl: async url => url.includes('/api/') ? response(null) : new Response('<h1>This job is no longer available</h1>') })).status, 'closed');
});

test('Qualcomm joins index alias and employer list into one complete school-matching card', async () => {
  const report = await discover({ sources: [source], fetchImpl: async url => {
    if (url === SOURCE.dataUrl) return new Response(JSON.stringify([{ company_name: 'Qualcomm', title: 'Firmware Development Intern - PAL', active: true, is_visible: true, locations: ['Markham, ON, Canada'], terms: ['Summer 2027'], url: item().publicUrl.replace('careers.qualcomm.com', 'qualcomm.eightfold.ai') }]));
    return url.includes('/search?') ? list([item()]) : response(item());
  } });
  assert.equal(report.results.length, 1); const job = report.results[0];
  assert.equal(job.fullJd, true); assert.equal(job.requisitionId, '3097052'); assert.equal(job.term, 'Unknown'); assert.ok(!job.identityConflict);
  assert.deepEqual(job.discoverySources.map(s => s.id).sort(), ['index', 'qualcomm']); assert.equal(job.sourceName, 'Qualcomm / Eightfold');
  const match = portalDiscovery({ company: 'Qualcomm', title: job.title, requisitionId: '3097052', term: 'Summer 2027', location: 'Markham, Ontario, Canada' }, report);
  assert.equal(match.candidates[0].requisitionId, '3097052'); assert.equal(match.candidates[0].stateCode, 'found');
});

test('Qualcomm hardware-only school postings keep the existing prefilter reason and employer ID', async () => {
  const hardware = item(446721156182, { name: 'FY27 Intern - MSIP Digital Design Engineering Internship - Canada (16 months)', displayJobId: '3096851', atsJobId: '3096851' });
  const report = await discover({ sources: [source], fetchImpl: async url => url === SOURCE.dataUrl ? new Response('', { status: 503 }) : list([hardware]) });
  assert.equal(report.results.length, 0); assert.equal(report.filteredJobs.length, 1);
  assert.equal(report.filteredJobs[0].requisitionId, '3096851'); assert.match(report.filteredJobs[0].reasons.join(), /CS \/ Data/);
  const match = portalDiscovery({ company: 'Qualcomm', title: hardware.name, requisitionId: '3096851', term: 'Summer 2027', location: 'Toronto' }, report);
  assert.equal(match.candidates[0].stateCode, 'prefiltered');
});
