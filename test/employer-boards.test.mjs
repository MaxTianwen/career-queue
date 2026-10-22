import test from 'node:test';
import assert from 'node:assert/strict';
import { boardFromUrl, boardRegistry, canadaFacet, readWorkdayBoard, readEmployerBoards } from '../src/employer-boards.mjs';
import { fetchCatalogue } from '../src/v2/catalogue.mjs';

const now = Date.parse('2026-10-22T12:00:00Z');
const entry = (url, extra = {}) => ({ url, company_name: 'Synthetic Co', locations: ['Toronto, ON, Canada'], date_posted: now / 1000 - 86400, ...extra });

test('board links are parsed only from real ATS URLs, keeping the Workday locale', () => {
  assert.deepEqual(boardFromUrl('https://acme.wd3.myworkdayjobs.com/en-US/Acme_Careers/job/Toronto/Intern_R1'), {
    type: 'workday', board: 'acme/Acme_Careers', tenant: 'acme', site: 'Acme_Careers', base: 'https://acme.wd3.myworkdayjobs.com/en-US/Acme_Careers'
  });
  assert.equal(boardFromUrl('https://acme.wd3.myworkdayjobs.com/Acme/job/X_R2').base, 'https://acme.wd3.myworkdayjobs.com/Acme');
  assert.deepEqual(boardFromUrl('https://job-boards.greenhouse.io/acme/jobs/123'), { type: 'greenhouse', board: 'acme' });
  assert.deepEqual(boardFromUrl('https://boards.greenhouse.io/embed/job_app?for=acme&token=1'), { type: 'greenhouse', board: 'acme' });
  assert.deepEqual(boardFromUrl('https://jobs.lever.co/acme/0f0e0d0c-0000-4000-8000-000000000000'), { type: 'lever', board: 'acme' });
  assert.deepEqual(boardFromUrl('https://jobs.ashbyhq.com/acme/0f0e0d0c-0000-4000-8000-000000000000'), { type: 'ashby', board: 'acme' });
  for (const bad of ['http://acme.wd3.myworkdayjobs.com/Acme/job/X', 'https://acme.wd3.myworkdayjobs.com/Acme/details/X', 'https://evil.example/acme/jobs/1', 'not a url'])
    assert.equal(boardFromUrl(bad), null, bad);
});

test('registry keeps recent Canadian boards once, skips fixed sources and US-only or stale links', () => {
  const registry = boardRegistry(
    [
      entry('https://acme.wd3.myworkdayjobs.com/en-US/Acme/job/A_R1'),
      entry('https://acme.wd3.myworkdayjobs.com/en-US/Acme/job/B_R2'),
      entry('https://job-boards.greenhouse.io/beta/jobs/1', { locations: ['Austin, TX'] }),
      entry('https://job-boards.greenhouse.io/gamma/jobs/1', { date_posted: now / 1000 - 500 * 86400 }),
      entry('https://jobs.lever.co/telesat/0f0e0d0c-0000-4000-8000-000000000000'),
      entry('https://jobs.lever.co/delta/0f0e0d0c-0000-4000-8000-000000000000', { locations: ['Waterloo, ON'] })
    ],
    { now }
  );
  assert.deepEqual(registry.map(b => [b.id, b.hits]), [['board:workday:acme/acme', 2], ['board:lever:delta', 1]]);
});

test('Canada facet is found at any depth and under any parameter name', () => {
  assert.deepEqual(canadaFacet([{ facetParameter: 'Location_Country', values: [{ descriptor: 'United States', id: 'us' }, { descriptor: 'Canada', id: 'ca' }] }]), { Location_Country: ['ca'] });
  assert.deepEqual(canadaFacet([{ facetParameter: 'locationMainGroup', values: [{ facetParameter: 'locationHierarchy1', values: [{ descriptor: 'Canada', id: 'h1' }] }] }]), { locationHierarchy1: ['h1'] });
  assert.equal(canadaFacet([{ facetParameter: 'jobFamily', values: [{ descriptor: 'Engineering', id: 'e' }] }]), null);
});

const response = body => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
const posting = (path, title, extra = {}) => ({ title, externalPath: path, locationsText: 'Toronto, Ontario', postedOn: 'Posted Today', bulletFields: ['R' + path.length], ...extra });

test('Workday board narrows to Canada, pages each keyword, dedupes and keeps relative dates as hints only', async () => {
  const source = { id: 'board:workday:acme/acme', name: 'Acme', type: 'workday', tenant: 'acme', site: 'Acme', base: 'https://acme.wd3.myworkdayjobs.com/en-US/Acme', url: 'https://acme.wd3.myworkdayjobs.com/en-US/Acme' };
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    if (!Object.keys(body.appliedFacets).length) return response({ total: 2, facets: [{ facetParameter: 'locationCountry', values: [{ descriptor: 'Canada', id: 'ca' }] }], jobPostings: [] });
    if (body.searchText === 'intern' && body.offset === 0)
      return response({ jobPostings: Array.from({ length: 20 }, (_, i) => posting(`/job/Toronto/Intern-${i}_R${i}`, `Software Intern ${i}`)) });
    if (body.searchText === 'intern') return response({ jobPostings: [posting('/job/Toronto/Hardware_R99', 'Hardware Co-op', { locationsText: '2 Locations', postedOn: 'Posted 3 Days Ago' })] });
    return response({ jobPostings: [posting('/job/Toronto/Intern-0_R0', 'Software Intern 0')] });
  };
  const result = await readWorkdayBoard(source, fetchImpl, { keywords: ['intern', 'co-op'], pages: 3 });
  assert.equal(calls[0].url, 'https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/Acme/jobs');
  assert.ok(calls.slice(1).every(c => c.body.appliedFacets.locationCountry[0] === 'ca'));
  assert.equal(result.status, 'complete');
  assert.equal(result.jobs.length, 21);
  assert.equal(result.jobs[0].url, 'https://acme.wd3.myworkdayjobs.com/en-US/Acme/job/Toronto/Intern-0_R0');
  const hw = result.jobs.find(j => j.title === 'Hardware Co-op');
  assert.equal(hw.location, '2 Locations · Canada');
  assert.equal(hw.postedAt, null);
  assert.equal(hw.sourceEvidence.listedPosted, 'Posted 3 Days Ago');
});

test('boards are read a few at a time, reused within the cache window and failures make the source partial', async () => {
  const registry = [
    { id: 'board:workday:a/a', name: 'A', type: 'workday', tenant: 'a', site: 'a', base: 'https://a.wd1.myworkdayjobs.com/a', url: 'https://a.wd1.myworkdayjobs.com/a' },
    { id: 'board:workday:b/b', name: 'B', type: 'workday', tenant: 'b', site: 'b', base: 'https://b.wd1.myworkdayjobs.com/b', url: 'https://b.wd1.myworkdayjobs.com/b' }
  ];
  let calls = 0;
  const fetchImpl = async url => {
    calls++;
    if (url.includes('//b.')) return { ok: false, status: 403, text: async () => '' };
    return response({ jobPostings: [posting('/job/X/Data-Intern_R1', 'Data Intern')] });
  };
  const cache = new Map();
  const first = await readEmployerBoards(registry, fetchImpl, { cache, now });
  assert.equal(first.status, 'partial');
  assert.equal(first.failed, 1);
  assert.equal(first.jobs.length, 1);
  const before = calls;
  const second = await readEmployerBoards(registry, fetchImpl, { cache, now: now + 3600000 });
  assert.equal(second.reused, 1);
  assert.equal(calls - before, 1, 'only the failed board is retried');
  assert.equal((await readEmployerBoards([], fetchImpl, { cache })).status, 'failed');
});

test('catalogue feeds the index registry to the boards source and reads a shared posting once', async () => {
  const url = 'https://acme.wd3.myworkdayjobs.com/en-US/Acme/job/Toronto/Hardware-Intern_R1';
  let detailReads = 0,
    seenRegistry = null;
  const result = await fetchCatalogue({
    sources: [{ id: 'index', name: 'Index' }, { id: 'boards', name: '雇主招聘板直读' }],
    readIndex: async () => ({ jobs: [{ company: 'Acme', title: 'Hardware Engineering Intern', url, location: 'Toronto, ON, Canada', term: 'Summer 2027', jd: '', indexInternship: true }], raw: 1, status: 'complete', registry: [{ id: 'board:workday:acme/acme' }] }),
    readBoards: async registry => {
      seenRegistry = registry;
      return { jobs: [{ company: 'Acme', title: 'Hardware Engineering Intern', url, location: 'Toronto, Ontario', jd: '' }], raw: 1, status: 'complete', boards: registry.length };
    },
    readDetail: async () => {
      detailReads++;
      await new Promise(r => setTimeout(r, 20));
      return { jd: 'Design and verify hardware for our Summer 2027 internship. Duration: 4 months.' };
    }
  });
  assert.deepEqual(seenRegistry, [{ id: 'board:workday:acme/acme' }]);
  assert.equal(result.jobs.length, 1);
  assert.deepEqual(result.jobs[0].sources.map(s => s.id).sort(), ['boards', 'index']);
  assert.ok(detailReads <= 2);
  assert.equal(result.sources.find(s => s.id === 'boards').name, '雇主招聘板直读（1 个）');
});
