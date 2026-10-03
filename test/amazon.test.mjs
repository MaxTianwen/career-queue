import test from 'node:test';
import assert from 'node:assert/strict';
import { amazonUrl, amazonPosting, amazonSearchUrl, fetchAmazon } from '../src/amazon.mjs';
import { EMPLOYER_SOURCES, readEmployerBoard } from '../src/discovery-sources.mjs';
import { discover, extractFacts, SOURCE } from '../src/discovery.mjs';
import { checkAvailability } from '../src/availability.mjs';
import { portalDiscovery } from '../src/portal.mjs';
import { postingUrl, sourceName } from '../src/discovery-records.mjs';

const source = EMPLOYER_SOURCES.find(s => s.id === 'amazon');
const job = (id = 10538066, extra = {}) => ({ id_icims: String(id), job_path: `/en/jobs/${id}/software-intern`, title: 'Software Developer Intern Summer 2027', description: 'Build software with a team. Duration: 8 months. This position is based in Toronto, Canada.', basic_qualifications: 'Python and SQL experience', preferred_qualifications: 'C++', location: 'CA, ON, Toronto', country_code: 'CAN', posted_date: 'September 11, 2026', updated_time: 'today', ...extra });
const reply = (jobs, hits = jobs.length) => new Response(JSON.stringify({ jobs, hits, error: null }));

test('Amazon canonical links reject foreign hosts, credentials, ports and application paths', () => {
  assert.equal(amazonUrl('https://amazon.jobs/en/jobs/12/example?ref=school#x'), 'https://www.amazon.jobs/en/jobs/12/example');
  for (const url of ['http://www.amazon.jobs/en/jobs/12/example', 'https://www.amazon.jobs.evil.test/en/jobs/12/example', 'https://x@www.amazon.jobs/en/jobs/12/example', 'https://www.amazon.jobs:99/en/jobs/12/example', 'https://account.amazon.jobs/jobs/12/apply', 'https://www.amazon.jobs/en/jobs/12/example/apply']) assert.equal(amazonUrl(url), null);
  assert.equal(postingUrl('https://amazon.jobs/en/jobs/12/example?ref=a'), amazonUrl('https://amazon.jobs/en/jobs/12/example'));
  assert.equal(sourceName({ url: job().job_path }), '来源待核实');
  assert.equal(sourceName({ url: amazonUrl('https://amazon.jobs/en/jobs/12/example') }), 'Amazon Jobs');
});

test('Amazon keeps complete requirement sections and date precision without guessing pay or work mode', () => {
  const parsed = amazonPosting(job(), 'https://www.amazon.jobs/en/search.json');
  assert.match(parsed.jd, /Description[\s\S]*Basic Qualifications[\s\S]*Python[\s\S]*Preferred Qualifications[\s\S]*C\+\+/);
  assert.equal(parsed.postedAt, '2026-09-11'); assert.equal(parsed.salary, '未披露'); assert.equal(parsed.workMode, 'unknown'); assert.equal(parsed.deadline, null);
  assert.match(parsed.location, /Canada/); assert.equal(parsed.requisitionId, '10538066');
  for (const posted_date of ['today', 'February 30, 2026', 'Invalid 2, 2026']) assert.equal(amazonPosting(job(1, { posted_date }), '').postedAt, null);
  for (const bad of [{ job_path: '/en/jobs/999/other' }, { description: '' }, { basic_qualifications: '' }, { job_path: '//evil.test/en/jobs/10538066/x' }]) assert.throws(() => amazonPosting(job(undefined, bad), ''));
});

test('Amazon multiple explicit start options are not silently reduced to the first Summer date', () => {
  const parsed = amazonPosting(job(1, { title: 'Software Intern - 2027', description: '12-16 month internship (starts May 2027)\n3-4 month internship (starts January 2027, May 2027, September 2027)' }), '');
  assert.equal(extractFacts(parsed).term, 'Unknown'); assert.match(parsed.fieldEvidence.term.raw, /January 2027/);
  assert.equal(extractFacts(amazonPosting(job(1, { title: 'Software Intern - 2027', description: 'Internship starts May 2027.' }), '')).term, 'Summer 2027');
});

test('Amazon paginates both bounded Canadian searches and combines cross-query duplicates', async () => {
  const calls = [];
  const result = await readEmployerBoard(source, async (url, options) => {
    const u = new URL(url); calls.push(url); assert.equal(u.searchParams.get('country'), 'CAN'); assert.equal(options.redirect, 'error');
    if (u.searchParams.get('base_query') === 'co-op') return reply([job(1)]);
    return u.searchParams.get('offset') === '0' ? reply(Array.from({ length: 100 }, (_, i) => job(i + 1)), 101) : reply([job(101)], 101);
  });
  assert.equal(result.status, 'complete'); assert.equal(result.jobs.length, 101); assert.equal(result.raw, 102); assert.equal(calls.length, 3);
  await assert.rejects(readEmployerBoard({ ...source, board: 'other' }, async () => assert.fail()));
});

test('Amazon marks failed, short, changing, duplicate and malformed lists incomplete', async () => {
  const partial = await readEmployerBoard(source, async url => url.includes('co-op') ? new Response('', { status: 503 }) : reply([job()]));
  assert.equal(partial.status, 'partial'); assert.equal(partial.jobs.length, 1);
  for (const fn of [async () => reply([job()], 101), async () => reply([job(), job()]), async () => reply([job(1, { country_code: 'USA' })]), async () => new Response('{bad'), async () => new Response('', { status: 429 })]) assert.notEqual((await readEmployerBoard(source, fn)).status, 'complete');
  let n = 0;
  const changing = await readEmployerBoard(source, async () => reply(Array.from({ length: 100 }, (_, i) => job(i + 1 + n * 100)), n++ ? 202 : 201));
  assert.equal(changing.status, 'partial'); assert.match(changing.error, /总数变化/);
});

test('Amazon has a bounded pagination cap', async () => {
  let calls = 0;
  const result = await readEmployerBoard(source, async () => { const page = calls++; return reply(Array.from({ length: 100 }, (_, i) => job(i + 1 + page * 100)), 1001); });
  assert.equal(result.status, 'partial'); assert.equal(result.pages, 10); assert.equal(result.jobs.length, 1000);
});

test('Amazon detail lookup checks exact ID and does not treat missing, blocked or malformed content as closed', async () => {
  const candidate = { url: 'https://www.amazon.jobs/en/jobs/10538066/software-intern', deadline: null };
  const found = await checkAvailability(candidate, { fetchImpl: async url => { assert.equal(url, amazonSearchUrl('10538066')); return reply([job()]); } });
  assert.equal(found.status, 'open'); assert.match(found.job.jd, /Basic Qualifications/);
  for (const rows of [[], [job(99)], [job(), job()], [job(undefined, { description: '' })]]) {
    const result = await checkAvailability(candidate, { fetchImpl: async url => url.includes('search.json') ? reply(rows) : new Response('<h1>Unavailable</h1>') });
    assert.equal(result.status, 'unknown');
  }
  assert.equal((await checkAvailability(candidate, { fetchImpl: async () => new Response('', { status: 403 }) })).status, 'unknown');
  await assert.rejects(fetchAmazon({ url: 'https://evil.test/en/jobs/1/x' }, async () => assert.fail()));
});

test('Amazon unifies with the public index and supplies school requisition evidence without saving applications', async () => {
  const report = await discover({ sources: [source], fetchImpl: async url => {
    if (url === SOURCE.dataUrl) return new Response(JSON.stringify([{ company_name: 'Amazon', title: job().title, active: true, is_visible: true, locations: ['Toronto'], terms: ['Summer 2027'], url: 'https://amazon.jobs/en/jobs/10538066/software-intern?ref=school' }]));
    return reply([job()]);
  } });
  assert.equal(report.results.length, 1); const result = report.results[0];
  assert.equal(result.fullJd, true); assert.equal(result.sourceName, 'Amazon Jobs'); assert.equal(result.requisitionId, '10538066'); assert.equal(result.discoverySources.length, 2);
  const match = portalDiscovery({ company: 'Amazon', title: job().title, requisitionId: '10538066', term: 'Summer 2027', location: 'Toronto' }, report);
  assert.equal(match.status, 'candidates'); assert.equal(match.candidates[0].requisitionId, '10538066');
  assert.equal(report.metrics.bySource.find(s => s.id === 'amazon').unsupported, 0);
});

test('Amazon multi-season posting merges the index single-season hint into one official ID card', async () => {
  const posting = job(10538066, { title: 'Software Intern - 2027', description: '12-16 month internship (starts May 2027)\n3-4 month internship (starts January 2027, May 2027, September 2027)' });
  const report = await discover({ sources: [source], fetchImpl: async url => url === SOURCE.dataUrl
    ? new Response(JSON.stringify([{ company_name: 'Amazon', title: 'Software Engineer Intern', active: true, is_visible: true, locations: ['Toronto'], terms: ['Summer 2027'], url: 'https://amazon.jobs/en/jobs/10538066/software-intern' }]))
    : reply([posting]) });
  assert.equal(report.results.length, 1); assert.equal(report.results[0].term, 'Unknown'); assert.ok(!report.results[0].identityConflict);
  assert.deepEqual(report.results[0].discoverySources.map(s => s.id).sort(), ['amazon', 'index']);
  assert.equal(report.results[0].indexEvidence.terms[0], 'Summer 2027');
});
