import test from 'node:test';
import assert from 'node:assert/strict';
import { placementOptions, placementTermText } from '../web/placement-options.js';
import { matchesFilters, matchesTerm, sortJobs } from '../web/job-view.js';
import { durationText } from '../web/job-facts.js';
import { fieldEvidenceView } from '../web/discovery-sources-view.js';
import { normalizeJob, evaluateJob, newRecord } from '../src/core.mjs';
import { NotionStore, richText } from '../src/notion.mjs';
import { previewPortal, portalDiscovery, linkPortal } from '../src/portal.mjs';

// Public JD excerpts recorded from Qualcomm and Amazon, 2026-10-03.
const qualcomm = { company: 'Qualcomm', title: 'Intern', term: 'Unknown', durationMonths: 16,
  jd: 'For 16-month internships: must be available May/June 2027 - August/September 2028', location: 'Markham, ON' };
const amazon = { company: 'Amazon', title: 'ML Systems Software Development Engineer Intern', term: 'Unknown', durationMonths: null,
  requisitionId: '10538066', url: 'https://www.amazon.jobs/en/jobs/10538066', location: 'Toronto, ON', fullJd: true,
  jd: '12-16 month internship (starts May 2027)\n3-4 month internship (starts January 2027, May 2027, September 2027)' };

test('Qualcomm start interval uses May/June, never its end year or graduation year', () => {
  for (const jd of [qualcomm.jd, qualcomm.jd.replaceAll('/', ' or ')]) {
    const j = { ...qualcomm, jd: `${jd}\nExpected graduation November 2028.` };
    assert.equal(placementTermText(j), 'Summer 2027');
    assert.equal(durationText(j), '16 个月');
    assert.equal(matchesFilters(j, { term: 'Summer 2027', duration: '16', location: 'gta' }), true);
    assert.equal(matchesTerm(j, 'Fall 2028'), false);
    assert.equal(matchesTerm(j, 'Unknown'), false);
  }
});
test('Amazon season and duration match one option rather than a Cartesian product', () => {
  const expected = { Winter: [true, false, false, false, false], Summer: [true, false, true, true, true], Fall: [true, false, false, false, false] };
  for (const [season, values] of Object.entries(expected)) for (const [i, duration] of ['4', '8', '12', '16', '8plus'].entries()) {
    assert.equal(matchesFilters(amazon, { term: `${season} 2027`, duration }), values[i], `${season} + ${duration}`);
  }
  assert.equal(placementTermText(amazon), 'Winter 2027 / Summer 2027 / Fall 2027');
  assert.equal(durationText(amazon), '12–16 或 3–4 个月');
  assert.equal(matchesFilters(amazon, { duration: 'unknown' }), false);
  assert.equal(matchesFilters(amazon, {}), true);
});
test('separate exact lengths stay separate; same-season shared years and cross-season starts are supported', () => {
  const j = { ...qualcomm, durationMonths: null, jd: 'For 12 or 16-month internships: must be available May/June 2027 - August 2028' };
  assert.equal(matchesFilters(j, { duration: '14' }), false);
  assert.equal(matchesFilters(j, { duration: '12' }), true);
  assert.equal(matchesFilters(j, { duration: '16' }), true);
  assert.equal(durationText(j), '12 或 16 个月');
  assert.deepEqual(placementOptions({ jd: '4 month internship (starts August/September 2027)' }).terms, ['Summer 2027', 'Fall 2027']);
});
test('missing dates, fiscal years and non-start dates never invent a start season', () => {
  for (const jd of ['FY27 internship', 'Graduate May 2027', 'Application deadline May 2027', 'Internship ends May 2027']) {
    assert.equal(placementOptions({ jd }), null);
    assert.equal(matchesTerm({ jd }, 'Summer 2027'), false);
  }
  for (const dates of ['May/June', 'May FY27', 'May 2027 or later', 'May 2027, September']) {
    const j = { jd: `16-month internship (starts ${dates})`, indexEvidence: { terms: ['Summer 2027'] } };
    assert.equal(placementOptions(j).status, 'incomplete');
    assert.equal(matchesTerm(j, 'Summer 2027'), false);
    assert.equal(matchesTerm(j, 'Unknown'), true);
  }
});
test('a partial option set or conflicting saved fields stays marked for verification', () => {
  const partial = { ...amazon, jd: `${amazon.jd}\n8 month internship (starts January)` };
  assert.equal(placementOptions(partial).status, 'incomplete');
  assert.equal(matchesTerm(partial, 'Winter 2027'), false);
  const conflict = { ...qualcomm, term: 'Winter 2027' };
  assert.equal(placementOptions(conflict).status, 'conflict');
  assert.equal(placementTermText(conflict), 'Winter 2027（待核实）');
  assert.equal(matchesFilters(conflict, { term: 'Summer 2027' }), false);
  assert.match(fieldEvidenceView(conflict), /已保存字段或其他开始日期不一致/);
  assert.equal(placementOptions({ ...qualcomm, durationMonths: 4 }).status, 'conflict');
  assert.equal(placementOptions({ ...qualcomm, jd: `${qualcomm.jd}\nStart date: January 2028` }).status, 'conflict');
  assert.equal(placementOptions({ jd: 'No 16-month internship (starts May 2027)' }).status, 'incomplete');
});
test('details expose paired options, escaped quotes and source links without stale unknown field evidence', () => {
  const j = { ...amazon, fieldEvidence: { term: { status: 'ambiguous', raw: 'OLD_UNKNOWN' } } };
  const html = fieldEvidenceView(j);
  assert.match(html, /按同一选项组合筛选/);
  assert.match(html, /Summer 2027 · 12–16 个月/);
  assert.match(html, /Winter 2027 \/ Summer 2027 \/ Fall 2027 · 3–4 个月/);
  assert.match(html, /核对岗位来源/);
  assert.doesNotMatch(html, /OLD_UNKNOWN/);
});
test('school single-season match accepts official multi-season options and still requires explicit linking', () => {
  const j = newRecord(normalizeJob(amazon));
  const row = { id: 'school-1', company: j.company, title: j.title, term: 'Summer 2027', location: j.location, requisitionId: j.requisitionId };
  const preview = previewPortal([row], [j])[0];
  assert.equal(preview.category, 'exact');
  assert.deepEqual(preview.candidates[0].conflicts, []);
  assert.equal(preview.candidates[0].term, 'Unknown');
  assert.match(preview.candidates[0].termLabel, /Winter 2027/);
  const candidate = portalDiscovery(row, { finishedAt: '2026-10-03T13:00:00Z', results: [j] }).candidates[0];
  assert.equal(candidate.strong, true);
  assert.throws(() => linkPortal(j, row, [j], {}), /确认关联/);
  assert.ok(previewPortal([{ ...row, term: 'Summer 2028' }], [j])[0].candidates[0].conflicts.includes('入职批次不同'));
});
test('saved Notion JD enables new filters without writes or altering identity, materials, status or automatic evaluation', () => {
  const j = { ...newRecord(normalizeJob(amazon)), materialVersion: 'v3', notes: 'Keep', status: '已投递', applicationDate: '2026-10-01' };
  const store = new NotionStore({ token: 'fixture', dataSourceId: '11111111-1111-4111-8111-111111111111', fetchImpl: () => assert.fail('No writes or requests expected') });
  const saved = store.decode({ id: 'page', properties: { Payload: { rich_text: richText(JSON.stringify(j)) }, Status: { select: { name: j.status } }, Notes: { rich_text: richText(j.notes) }, 'Application date': { date: { start: j.applicationDate } } } });
  const before = structuredClone(saved), evaluation = evaluateJob(saved);
  assert.equal(matchesFilters(saved, { term: 'Summer 2027', duration: '16' }), true);
  assert.equal(matchesFilters(saved, { term: 'Winter 2027', duration: '16' }), false);
  placementTermText(saved); durationText(saved); fieldEvidenceView(saved);
  assert.deepEqual(saved, before);
  assert.equal(normalizeJob(saved).key, j.key);
  assert.deepEqual(evaluateJob(saved), evaluation);
  assert.equal(saved.materialVersion, 'v3');
  assert.equal(saved.applicationDate, '2026-10-01');
});
test('derived options follow JD replacement, clearing filters and sorting never split a job', () => {
  const j = { ...amazon, key: 'one', match: { score: 60 } };
  assert.equal(matchesTerm(j, 'Winter 2027'), true);
  const updated = { ...j, jd: '12-16 month internship (starts May 2027)' };
  assert.equal(matchesTerm(updated, 'Winter 2027'), false);
  assert.deepEqual(sortJobs([j].filter(x => matchesFilters(x, {})), 'published').map(x => x.key), ['one']);
  assert.equal(matchesTerm({ term: 'Unknown', indexEvidence: { terms: ['Fall 2027'] } }, 'Fall 2027'), true);
});
