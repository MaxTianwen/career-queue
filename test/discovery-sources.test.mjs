import test from 'node:test';
import assert from 'node:assert/strict';
import { readEmployerBoard, boardPosting, postingText } from '../src/discovery-sources.mjs';
import { discover, SOURCE, extractFacts } from '../src/discovery.mjs';
import { mergeDiscoveryJobs } from '../src/discovery-records.mjs';
import { durationText } from '../web/job-facts.js';
import { matchesFilters } from '../web/job-view.js';
import { discoverySourcesView, fieldEvidenceView } from '../web/discovery-sources-view.js';

const now = new Date('2026-09-29T15:00:00Z');
const source = (type = 'greenhouse') => ({ id: type, name: 'Synthetic', type, board: 'synthetic', url: `https://example.com/${type}` });
const reply = data => new Response(JSON.stringify(data));
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const gh = (n, extra = {}) => ({ id: n, title: 'Software Intern Summer 2027', content: '&lt;p&gt;Duration: 8 months&lt;/p&gt;', location: { name: 'Toronto' }, first_published: '2026-09-20', ...extra });
const ashby = (n, extra = {}) => ({ id: id(n), title: 'Data Intern Winter 2027', descriptionPlain: 'SQL required. Duration: 4 months', isListed: true, location: 'Toronto', workplaceType: 'Hybrid', ...extra });
const entry = n => ({ company_name: 'Synthetic', title: 'Software Intern Summer 2027', active: true, is_visible: true, terms: ['Summer 2027'], locations: ['Toronto'], url: `https://job-boards.greenhouse.io/synthetic/jobs/${n}` });

test('public boards retain official fields and ignore embedded API/host instructions', async () => {
  const result = await readEmployerBoard(source(), async (url, options) => {
    assert.equal(url, 'https://boards-api.greenhouse.io/v1/boards/synthetic/jobs?content=true');
    assert.equal(options.redirect, 'error');
    return reply({ jobs: [gh(1, { absolute_url: 'https://localhost/private', updated_at: '2026-09-29', requisition_id: 'REQ1' })], meta: { total: 1 } });
  });
  assert.equal(result.status, 'complete'); assert.equal(result.jobs[0].postedAt, '2026-09-20');
  assert.equal(result.jobs[0].jd, 'Duration: 8 months'); assert.match(result.jobs[0].url, /^https:\/\/job-boards.greenhouse.io/);
  assert.equal(result.jobs[0].sourceEvidence.requisitionIdField, 'requisition_id');
  assert.equal(postingText('&lt;h2&gt;Required&lt;/h2&gt;&lt;li&gt;C&#43;&#43;&lt;/li&gt;'), 'Required\n\n• C++');
});

test('Ashby rejects unlisted/invalid records and preserves salary currency/unit without creating a publication time', async () => {
  const result = await readEmployerBoard(source('ashby'), async () => reply({ jobs: [ashby(1, { compensation: { summaryComponents: [
    { compensationType: 'EquityPercentage', minValue: 1, maxValue: 2 },
    { compensationType: 'Salary', currencyCode: 'CAD', interval: '1 YEAR', minValue: 50000, maxValue: 60000 }
  ] } }), ashby(2, { isListed: false }), { id: 'bad' }] }));
  assert.equal(result.jobs.length, 1); assert.equal(result.malformed, 1); assert.equal(result.status, 'partial');
  assert.equal(result.jobs[0].salary, 'CAD 50000–60000 / 1 YEAR'); assert.equal(result.jobs[0].postedAt, null);
  assert.equal(result.jobs[0].workMode, 'hybrid');
});

test('Lever paginates and retains retrieved jobs if later page is throttled', async () => {
  let count = 0;
  const fetchImpl = async url => {
    assert.match(url, new RegExp(`skip=${count * 100}$`)); count++;
    return count === 1 ? reply(Array.from({ length: 100 }, (_, i) => ({ id: id(i), text: 'Software Intern', descriptionPlain: 'Official JD', categories: { location: 'Toronto' }, createdAt: 100 }))) : new Response('', { status: 429 });
  };
  const result = await readEmployerBoard(source('lever'), fetchImpl);
  assert.equal(result.status, 'partial'); assert.equal(result.raw, 100); assert.equal(result.jobs.length, 100); assert.match(result.error, /429/);
  assert.equal(result.jobs[0].postedAt, null);
});

test('Lever completes a two-page list and guards page cap / repeated page', async () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ id: id(i), text: 'Intern', descriptionPlain: 'JD' }));
  let count = 0;
  const complete = await readEmployerBoard(source('lever'), async () => reply(count++ ? [] : rows));
  assert.equal(complete.status, 'complete'); assert.equal(complete.pages, 2);
  const repeated = await readEmployerBoard(source('lever'), async () => reply(rows));
  assert.equal(repeated.status, 'partial'); assert.ok(repeated.pages <= 20); assert.equal(repeated.jobs.length, 100);
});

test('empty, incomplete count, malformed and failed sources are distinct outcomes', async () => {
  assert.equal((await readEmployerBoard(source(), async () => reply({ jobs: [], meta: { total: 0 } }))).status, 'complete');
  const partial = await readEmployerBoard(source(), async () => reply({ jobs: [gh(1)], meta: { total: 2 } }));
  assert.equal(partial.status, 'partial'); assert.equal(partial.jobs.length, 1);
  for (const fetchImpl of [async () => reply({ changed: true }), async () => { throw new Error('Timeout'); }, async () => new Response('', { status: 503 })]) {
    assert.notEqual((await readEmployerBoard(source(), fetchImpl)).status, 'complete');
  }
  await assert.rejects(readEmployerBoard({ ...source(), board: '../private' }), /不支持/);
});

test('unified discovery merges aliases and shares inline JD, metrics separate baseline additions and pending facts', async () => {
  const fetchImpl = async url => url === SOURCE.dataUrl ? reply([entry(1), { ...entry(1), url: 'https://boards.greenhouse.io/synthetic/jobs/1/apply' }]) : reply({ jobs: [gh(1), gh(2, { title: 'Data Intern Fall 2027' })], meta: { total: 2 } });
  const first = await discover({ sources: [source()], now, fetchImpl });
  const second = await discover({ sources: [source()], now, fetchImpl });
  assert.equal(first.results.length, 2); assert.equal(first.duplicates, 2); assert.equal(first.metrics.exact, 2);
  assert.equal(first.metrics.pending, 1); assert.equal(first.metrics.incremental, 0);
  assert.equal(first.results.find(j => j.url.endsWith('/1')).discoverySources.length, 2);
  assert.deepEqual(first.results.map(j => j.key), second.results.map(j => j.key));
  assert.equal(first.metrics.bySource.find(s => s.id === 'greenhouse').inline, 2);
});

test('index failure still yields employer jobs and disables claims about baseline additions', async () => {
  const result = await discover({ sources: [source()], now, fetchImpl: async url => url === SOURCE.dataUrl ? new Response('', { status: 503 }) : reply({ jobs: [gh(1)] }) });
  assert.equal(result.partial, true); assert.equal(result.results.length, 1);
  assert.equal(result.metrics.baselineComplete, false); assert.equal(result.metrics.pending, null);
  assert.match(result.errors[0], /503/);
});

test('one failed employer does not discard successful index or other employer', async () => {
  const result = await discover({ sources: [source(), source('ashby')], now, fetchImpl: async url => url === SOURCE.dataUrl ? reply([entry(1)]) : url.includes('ashby') ? new Response('', { status: 429 }) : reply({ jobs: [gh(1)] }) });
  assert.equal(result.partial, true); assert.equal(result.results.length, 1); assert.equal(result.sources.find(s => s.id === 'ashby').status, 'failed');
});

test('unknown fields do not cause fake identity conflict, whole-source facts and JD survive grouping', () => {
  const a = { ...boardPosting(source(), gh(1), 'api'), term: 'Summer 2027', key: 'one', fullJd: true, salary: '未披露' };
  const b = { ...a, salary: 'CAD 25 / hour', jd: 'A second source JD', discoverySources: [{ id: 'index', name: 'Index' }] };
  const stats = {}, merged = mergeDiscoveryJobs([a, b], stats);
  assert.equal(merged.results.length, 1); assert.equal(stats.exact, 1);
  assert.equal(merged.results[0].salary, b.salary); assert.equal(merged.results[0].jd, b.jd);
  assert.deepEqual(new Set(merged.results[0].groupedSources.map(s => s.jd)), new Set([a.jd, b.jd]));
  assert.equal(merged.results[0].discoverySources.length, 2);
  assert.equal(mergeDiscoveryJobs([a, { ...b, location: 'Ottawa' }]).results.length, 2);
  assert.equal(mergeDiscoveryJobs([a, { ...b, term: 'Winter 2027' }]).results.length, 2);
});

test('JD salary, day-specific starts and duration ranges retain raw evidence without guessing currency or alternatives', () => {
  const j = extractFacts({ title: 'Software Intern', location: 'Toronto', jd: 'Term Start: January 6, 2027\nDuration: 8-12 months\nPay is CAD 25–30 per hour.\nWork arrangement: hybrid' });
  assert.equal(j.term, 'Winter 2027'); assert.equal(j.salary, 'CAD 25–30 per hour'); assert.equal(j.durationMonths, null);
  assert.equal(durationText(j), '8–12 个月'); assert.equal(matchesFilters(j, { duration: '12' }), true);
  assert.match(j.fieldEvidence.salary.raw, /CAD/); assert.equal(j.workMode, 'hybrid');
  const cohere = extractFacts({ title: 'Data Intern', jd: 'Available for a full-time 3-6 month internship. Parental leave for up to 6 months.' });
  assert.equal(durationText(cohere), '3–6 个月');
  const unknown = extractFacts({ title: 'Data Intern', jd: 'Duration: 8 or 12 months. Not an unpaid internship.' });
  assert.equal(unknown.durationMonths, null); assert.equal(durationText(unknown), '时长待核实'); assert.equal(unknown.paid, null);
  assert.equal(extractFacts({ title: 'Intern', jd: 'Learning budget CAD 1000 per year.' }).salary, '未披露');
  const multiple = extractFacts({ title: 'Data Intern', jd: 'Canada pay: CAD 25 per hour\nUS pay: USD 30 per hour' });
  assert.equal(multiple.salary, '未披露'); assert.equal(multiple.fieldEvidence.salary.status, 'ambiguous');
});

test('source and field views escape evidence, show partial and old snapshots without index assumptions', () => {
  assert.match(discoverySourcesView({}), /旧版搜索/);
  const html = discoverySourcesView({ sources: [{ name: '<script>', status: 'failed' }], partial: true });
  assert.match(html, /部分来源不完整/); assert.doesNotMatch(html, /<script>/);
  assert.match(fieldEvidenceView({ fieldEvidence: { salary: { status: 'not-extracted', raw: '<img>' } } }), /&lt;img&gt;/);
});
