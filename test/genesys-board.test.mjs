import test from 'node:test';
import assert from 'node:assert/strict';
import { EMPLOYER_SOURCES, readEmployerBoard } from '../src/discovery-sources.mjs';
import { discover, SOURCE, extractFacts } from '../src/discovery.mjs';
const source = EMPLOYER_SOURCES.find(s => s.id === 'genesys');
const job = n => ({ title: 'Software Intern Summer 2027', externalPath: `/job/Toronto/Software-Intern_JR${n}`, locationsText: 'Toronto', postedOn: 'Posted Today', bulletFields: [`JR${n}`] });
const reply = data => new Response(JSON.stringify(data));

test('explicit May/June start is Summer; conflicting seasonal starts and historical project dates stay unknown', () => {
  const fact = jd => extractFacts({ title: 'Software Intern', jd, location: 'Toronto' }).term;
  assert.equal(fact('Internship terms ranging from 8 to 16 months beginning in May/June 2027'), 'Summer 2027');
  assert.equal(fact('Starting May/September 2027'), 'Unknown');
  assert.equal(fact('Beginning in May 2027 or starting in September 2027'), 'Unknown');
  assert.equal(fact('Our project launched in May/June 2027'), 'Unknown');
});

test('Genesys uses fixed public endpoint and follows pages even when later totals are zero', async () => {
  const offsets = [];
  const result = await readEmployerBoard(source, async (url, options) => {
    assert.equal(url, 'https://genesys.wd1.myworkdayjobs.com/wday/cxs/genesys/Genesys/jobs');
    assert.equal(options.redirect, 'error'); assert.equal(options.method, 'POST');
    const input = JSON.parse(options.body); offsets.push(input.offset); assert.equal(input.searchText, '');
    return reply({ total: input.offset ? 0 : 21, jobPostings: input.offset ? [job(21)] : Array.from({ length: 20 }, (_, i) => job(i)) });
  });
  assert.deepEqual(offsets, [0, 20]); assert.equal(result.status, 'complete'); assert.equal(result.jobs.length, 21);
  assert.equal(result.jobs[0].postedAt, null); assert.equal(result.jobs[0].jd, '');
});

test('Genesys keeps partial data on failed pages, rejects redirects, foreign paths and mismatched IDs', async () => {
  const partial = await readEmployerBoard(source, async (_, opts) => JSON.parse(opts.body).offset ? new Response('', { status: 503 }) : reply({ total: 21, jobPostings: Array.from({ length: 20 }, (_, i) => job(i)) }));
  assert.equal(partial.status, 'partial'); assert.equal(partial.jobs.length, 20);
  const bad = await readEmployerBoard(source, async () => reply({ total: 3, jobPostings: [{ ...job(1), externalPath: 'https://evil.example/job/1' }, { ...job(2), bulletFields: ['JR999'] }, job(3)] }));
  assert.equal(bad.malformed, 2); assert.equal(bad.status, 'partial'); assert.equal(bad.jobs.length, 1);
  assert.equal((await readEmployerBoard(source, async () => { throw new Error('redirect rejected'); })).status, 'failed');
  await assert.rejects(readEmployerBoard({ ...source, board: 'Other' }, async () => assert.fail()));
});

test('Genesys rejects repeated and prematurely ended pagination rather than reporting complete coverage', async () => {
  const result = await readEmployerBoard(source, async () => reply({ total: 21, jobPostings: [job(1)] }));
  assert.equal(result.status, 'partial'); assert.match(result.error, /分页提前结束/);
  const duplicate = await readEmployerBoard(source, async () => reply({ total: 2, jobPostings: [job(1), job(1)] }));
  assert.equal(duplicate.status, 'partial'); assert.equal(duplicate.jobs.length, 1);
});

test('new board enters the real discovery pipeline and obtains full JD for a multiple-location listing', async () => {
  const report = await discover({ sources: [source], fetchImpl: async (url) => {
    if (url === SOURCE.dataUrl) return reply([{ company_name: 'Example', terms: [], active: false }]);
    if (url.includes('/wday/cxs/')) return reply({ total: 1, jobPostings: [{ ...job(10), locationsText: '2 Locations' }] });
    return new Response(`<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', identifier: { value: 'JR10' }, title: 'Software Intern Summer 2027', description: '<p>Python development. Duration: 8 months.</p>', jobLocation: { address: { addressLocality: 'Toronto', addressCountry: 'Canada' } }, datePosted: '2026-10-01' })}</script>`);
  } });
  assert.equal(report.results.length, 1); assert.equal(report.results[0].fullJd, true);
  assert.equal(report.results[0].requisitionId, 'JR10'); assert.equal(report.results[0].term, 'Summer 2027');
  assert.equal(report.results[0].readMethod, 'detail');
});

test('discovery retains public prefilter evidence without reading excluded JD or treating it as closed', async () => {
  const report = await discover({ sources: [], fetchImpl: async url => {
    assert.equal(url, SOURCE.dataUrl);
    return reply([{ company_name: 'Example', title: 'Software Intern', terms: ['Summer 2026'], active: true, is_visible: true, locations: ['Toronto'], url: 'https://example.com/old-season' }]);
  } });
  assert.equal(report.results.length, 0); assert.equal(report.filteredJobs.length, 1);
  assert.match(report.filteredJobs[0].reasons.join(' '), /索引入职季/);
  assert.ok(!report.filteredJobs[0].jd);
});
