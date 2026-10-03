import test from 'node:test';
import assert from 'node:assert/strict';
import { portalDiscovery } from '../src/portal.mjs';
import { discoveryView } from '../web/portal-import.js';
const row = { company: 'Genesys', title: 'Web Software Developer Intern - JR123', requisitionId: 'JR123', term: 'Summer 2027', location: 'Toronto' };
const job = { ...row, key: '1', title: 'Web Software Developer Intern', url: 'https://genesys.wd1.myworkdayjobs.com/en-US/Genesys/job/Developer_JR123', fullJd: true };
const report = { finishedAt: '2026-10-02T20:00:00Z', sources: [], results: [job] };

test('school discovery is a read-only comparison with exact IDs, conflicts and source gaps', () => {
  const before = JSON.stringify({ row, report });
  const found = portalDiscovery(row, report);
  assert.equal(found.candidates[0].strong, true); assert.match(found.message, /1 条来源候选/);
  assert.equal(JSON.stringify({ row, report }), before);
  assert.match(portalDiscovery(row, { ...report, results: [] }).message, /尚未接入/);
  assert.match(portalDiscovery(row, { ...report, results: [], sources: [{ name: 'Genesys', status: 'failed' }] }).message, /读取不完整/);
  assert.match(portalDiscovery(row, { ...report, results: [], sources: [{ name: 'Genesys', status: 'complete' }] }).message, /列表或筛选/);
  assert.match(portalDiscovery(row, null).message, /尚无已完成/);
  const conflict = portalDiscovery(row, { ...report, results: [{ ...job, term: 'Winter 2027' }, { ...job, key: '2', requisitionId: 'JR999' }] });
  assert.ok(conflict.candidates.every(c => !c.strong)); assert.ok(conflict.candidates[1].conflicts.length);
});

test('recorded prefilters explain missing jobs; historical snapshots do not invent a reason', () => {
  const result = portalDiscovery(row, { ...report, results: [], filteredJobs: [{ ...job, reasons: ['索引入职季不在目标范围'] }] });
  assert.match(result.candidates[0].state, /预筛排除/); assert.match(result.candidates[0].detail, /索引入职季/);
  assert.equal(portalDiscovery(row, { ...report, results: [] }).candidates.length, 0);
  assert.equal(portalDiscovery(row, { ...report, filteredJobs: [{ ...job, reasons: ['索引入职季'] }] }).candidates.length, 1);
});

test('grouped different requisitions suggest their own URL and JD, not the primary posting', () => {
  const other = { ...job, requisitionId: 'JR999', url: 'https://example.com/JR999', jd: 'Python' };
  const grouped = { ...other, groupedSources: [other, { ...job, jd: 'SQL' }] };
  const result = portalDiscovery(row, { ...report, results: [grouped] });
  assert.equal(result.candidates[0].requisitionId, 'JR123'); assert.equal(result.candidates[0].url, job.url);
  assert.equal(result.candidates[0].strong, true); assert.equal(result.candidates[1].strong, false);
  const crowded = portalDiscovery(row, { ...report, results: [...Array.from({length: 6}, (_, i) => ({ ...job, requisitionId: `JR${i}`, location: 'Toronto (Flexible)' })), { ...job, location: 'Toronto (Flexible)' }] });
  assert.equal(crowded.candidates[0].requisitionId, 'JR123'); assert.equal(crowded.total, 7);
});

test('discovery comparison explains closed dates and JD failure without changing school deadline', () => {
  const found = portalDiscovery({ ...row, deadline: '2027-01-01' }, { ...report, results: [{ ...job, deadline: '2026-01-01' }] }, new Date('2026-10-02'));
  assert.match(found.candidates[0].state, /官网截止已过/);
  const failed = portalDiscovery(row, { ...report, results: [{ ...job, fullJd: false, fetchError: 'HTTP 503' }] });
  assert.match(failed.candidates[0].state, /正文待补齐/); assert.equal(failed.candidates[0].detail, 'HTTP 503');
});

test('discovery suggestions are escaped, collapsed, and explicitly adopted for a new preview', () => {
  const escape = x => String(x).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
  const html = discoveryView({ index: 0, discovery: portalDiscovery(row, { ...report, results: [{ ...job, title: '<img src=x onerror=alert(1)>' }] }) }, escape);
  assert.ok(html.includes('&lt;img')); assert.ok(!html.includes('<img')); assert.match(html, /采用链接并重新匹配/);
  assert.ok(!html.includes(' checked')); assert.ok(!html.includes('<details open'));
});
