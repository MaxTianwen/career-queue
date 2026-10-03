import test from 'node:test';
import assert from 'node:assert/strict';
import { portalDiscovery, previewPortal } from '../src/portal.mjs';
import { discoveryView } from '../web/portal-import.js';

// Public Qualcomm titles from the recorded 2026-10-03 school comparison.
const title = detail => `FY27 Intern - ${detail} Internship - Canada (16 months)`;
const rows = ['PAL Firmware Development', 'Low Power AI Software Development'].map((detail, i) => ({
  id: i ? '116148' : '116153', company: 'Qualcomm', title: title(detail), location: 'Markham, ON', term: 'Summer 2027'
}));
const job = (detail, id, extra = {}) => ({ company: 'Qualcomm', title: title(detail), requisitionId: id,
  key: id, url: `https://example.com/jobs/${id}`, term: 'Unknown', location: 'Markham, Ontario, Canada', fullJd: true,
  jd: 'For 16-month internships: must be available May/June 2027 - August/September 2028', ...extra });
const report = { finishedAt: '2026-10-03T14:30:10Z', results: [
  job('Compute DSP/AI Processor Engineering', '3096485'), job('Low Power AI Software Development', '3096817'), job('PAL Firmware Development', '3097052')
], filteredJobs: [
  job('Analog Design', '3096793', { title: 'FY27 Intern - Analog Design Internship - Canada (12 or 16 months)' }),
  job('MSIP Design Methodology Engineering', '3096797'), job('Physical Mixed Layout Engineering', '3096813'),
  job('Display IP Engineering', '3096486'), job('MSIP Digital Design Engineering', '3096851'),
  job('Silicon Engineering', '3097249'), job('Silicon Validation', '3096815'), job('IP Applications Engineering', '3096847')
] };
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

test('unnumbered Qualcomm rows put identical titles first without establishing identity', () => {
  const before = JSON.stringify({ rows, report });
  for (const [i, row] of rows.entries()) {
    const result = portalDiscovery(row, report);
    assert.equal(result.candidates[0].requisitionId, i ? '3096817' : '3097052');
    assert.equal(result.candidates[0].rankingReason, '标题一致，仅供核对');
    assert.equal(result.candidates[0].strong, false);
    assert.ok(result.candidates[0].conflicts.includes('地点表述不同，需核对'));
    assert.ok(!result.candidates[0].conflicts.includes('入职批次不同'));
    const existing = previewPortal([row], report.results)[0];
    assert.equal(existing.category, 'possible'); assert.equal(existing.suggestedKey, null);
  }
  assert.equal(JSON.stringify({ rows, report }), before);
});
test('reliable numbering and links outrank a matching title even when location needs verification', () => {
  const row = { ...rows[0], requisitionId: '3096817' };
  const numbered = portalDiscovery(row, report).candidates;
  assert.equal(numbered[0].requisitionId, '3096817');
  assert.match(numbered[0].rankingReason, /编号/);
  assert.ok(numbered.find(c => c.requisitionId === '3097052').conflicts.includes('主记录招聘编号不同'));
  const linked = portalDiscovery({ ...rows[0], externalUrl: report.results[0].url }, report).candidates;
  assert.equal(linked[0].url, report.results[0].url); assert.match(linked[0].rankingReason, /链接/);
});
test('closer non-identical titles rank first, with deterministic ties across source order', () => {
  const a = job('PAL Firmware Development', 'A', { title: 'PAL Firmware Development Intern' });
  const b = { ...a, key: 'B', requisitionId: 'B', url: 'https://example.com/jobs/B' };
  const c = { ...a, key: 'C', requisitionId: 'C', title: 'Firmware Intern', url: 'https://example.com/jobs/C' };
  const row = { ...rows[0], title: 'PAL Firmware Intern' };
  const search = { finishedAt: report.finishedAt, results: [b, a, c] };
  const first = portalDiscovery(row, search).candidates;
  assert.deepEqual(first.map(c => c.requisitionId), ['A', 'B', 'C']);
  assert.deepEqual(portalDiscovery(row, { ...search, results: [...search.results].reverse() }).candidates, first);
});
test('all existing candidates remain accessible without broadening the matching threshold', () => {
  const result = portalDiscovery(rows[0], report);
  assert.equal(result.total, 10); assert.equal(result.candidates.length, 10);
  assert.ok(result.candidates.some(c => c.stateCode === 'prefiltered'));
  assert.equal(result.candidates.some(c => c.requisitionId === '3096485'), false);
  assert.equal(portalDiscovery({ ...rows[0], title: 'Unrelated Accountant' }, report).total, 0);
  assert.equal(portalDiscovery({ ...rows[0], company: 'Another company' }, report).total, 0);
});
test('additional candidate controls retain original indices, escaped reasons and explicit adoption', () => {
  const discovery = portalDiscovery(rows[0], report);
  discovery.candidates[5].rankingReason = '<img src=x onerror=alert(1)>';
  const html = discoveryView({ index: 3, discovery }, escape);
  assert.match(html, /展开其余 5 条候选/);
  assert.equal((html.match(/data-discovery-choice="3"/g) || []).length, 10);
  assert.match(html, /data-candidate="9"/);
  assert.match(html, /&lt;img/); assert.doesNotMatch(html, /<img/);
  assert.match(html, /排序不代表确认同一岗位/);
  assert.doesNotMatch(html, /<details[^>]*\bopen| checked|仅展示前 5 条/);
  assert.doesNotMatch(discoveryView({ index: 0, discovery: { ...discovery, candidates: discovery.candidates.slice(0, 2), total: 2 } }, escape), /展开其余/);
});
