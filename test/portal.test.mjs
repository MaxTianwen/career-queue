import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeJob, newRecord, markReady, markSubmitted } from '../src/core.mjs';
import { normalizePortalRow, previewPortal, linkPortal, updatePortal, portalSummary, portalRevision, prepareSchoolMaterials } from '../src/portal.mjs';
import { inQueue, inApplications, schoolMaterialsForm } from '../web/school-materials-view.js';

const now = new Date('2026-09-28T16:00:00Z');
const job = () => newRecord(normalizeJob({ company: 'Example Labs', title: 'Software Developer Intern',
  url: 'https://example.com/jobs/123', jd: 'Synthetic job', term: 'Summer 2027', location: 'Toronto', requisitionId: 'R123' }), now);
const row = (extra = {}) => ({ id: 'S456', url: 'https://school.example/jobs/456', company: 'Example Labs',
  title: 'Software Developer Intern', location: 'Toronto', term: 'Summer 2027', externalUrl: 'https://example.com/jobs/123',
  requisitionId: 'R123', deadline: '2026-10-01', ...extra });
const linked = () => updatePortal(linkPortal(job(), row(), [], { confirmed: true, requirement: 'required' }, now), { action: 'channel', channel: 'both', confirmed: true }, now);

test('channel is an explicit choice, never inferred from a missing link; only school completion changes list membership', () => {
  const base = { ...linked(), url: '', jdSource: 'school' };
  const input = { action: 'submitted', confirmed: true, attachmentsConfirmed: true, date: '2026-09-28', materialSource: 'other', materialNote: 'v1 and transcript' };
  assert.throws(() => updatePortal({ ...base, portal: { ...base.portal, channel: undefined } }, input, now), /申请渠道/);
  assert.throws(() => updatePortal(base, { ...input, attachmentsConfirmed: false }, now), /全部附件/);
  for (const channel of ['both', 'school-only']) {
    const selected = updatePortal(base, { action: 'channel', confirmed: true, channel }, now);
    const done = updatePortal(selected, input, now);
    const display = { ...done, portalSummary: portalSummary(done, now) };
    assert.equal(inApplications(display), channel === 'school-only');
    assert.equal(inQueue(display), channel !== 'school-only');
    assert.equal(done.status, 'Queue'); assert.equal(done.applicationDate, null);
    assert.equal(done.portal.attachmentsConfirmedAt, now.toISOString());
  }
});

test('school PDF preparation keeps official materials untouched, preserves prior snapshots and survives reimport', () => {
  const base = { ...linked(), materials: { resume: 'official.pdf' }, materialVersion: { version: 'official-v1' }, notes: 'keep' };
  const materials = { files: { resume: 'school.pdf' }, version: { version: 'school-v1', sha256: 'abc' }, inputHash: 'jd1' };
  const prepared = prepareSchoolMaterials(base, materials, now);
  assert.equal(prepared.status, base.status); assert.deepEqual(prepared.materials, base.materials);
  assert.equal(prepareSchoolMaterials(prepared, materials, now), prepared);
  materials.files.resume = 'mutated'; assert.equal(prepared.portal.preparedMaterials.files.resume, 'school.pdf');
  const reimport = linkPortal(prepared, row({ deadline: '2026-10-10' }), [prepared], { confirmed: true }, now);
  assert.deepEqual(reimport.portal.preparedMaterials, prepared.portal.preparedMaterials);
  assert.equal(reimport.portal.channel, 'both');
  const newer = prepareSchoolMaterials(prepared, { ...materials, version: { version: 'school-v2', sha256: 'def' } }, now);
  assert.equal(newer.portalHistory.at(-1).portal.preparedMaterials.version.version, 'school-v1');
  const submitted = updatePortal(prepared, { action: 'submitted', confirmed: true, attachmentsConfirmed: true, date: '2026-09-28',
    materialSource: 'school-reviewed', preparedVersion: 'school-v1', resumeHash: 'abc' }, now);
  assert.equal(submitted.portal.materials.version.version, 'school-v1');
  assert.throws(() => prepareSchoolMaterials(submitted, materials, now), /冻结/);
  assert.throws(() => updatePortal(prepared, { action: 'submitted', confirmed: true, attachmentsConfirmed: true, date: '2026-09-28', materialSource: 'school-reviewed', preparedVersion: 'school-v2', resumeHash: 'abc' }, now), /已变化/);
});

test('school PDF form requires channel and escapes source text; saving is separate from submission', () => {
  const base = { ...linked(), generatedMaterial: { version: '<script>', url: '/api/file?x=1', freshness: { needsReview: false } } };
  const html = schoolMaterialsForm(base);
  assert.match(html, /保存学校 PDF/); assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>/);
  assert.match(html, /保存材料不代表已投递/);
  assert.doesNotMatch(schoolMaterialsForm({ ...base, portal: { ...base.portal, channel: undefined } }), /id="school-materials-form"/);
  assert.equal(schoolMaterialsForm({ ...base, portal: { ...base.portal, status: 'submitted' } }), '');
});

test('school ID stays separate from employer ID; invalid links, dates and empty fields are rejected', () => {
  assert.equal(normalizePortalRow(row()).id, 'S456');
  for (const invalid of [{ id: '' }, { url: 'javascript:alert(1)' }, { externalUrl: 'https://user:pw@example.com' }, { deadline: '2026-02-30' }]) {
    assert.throws(() => normalizePortalRow(row(invalid)));
  }
  assert.equal(previewPortal([row(), row(), row({ id: '' })], [job()])[1].category, 'invalid');
  assert.throws(() => previewPortal(Array(101).fill(row()), [job()]));
});

test('strong identity, conflicting terms and ambiguous records are separated from title suggestions', () => {
  const j = job();
  assert.equal(previewPortal([row()], [j])[0].category, 'exact');
  assert.equal(previewPortal([row({ externalUrl: '', requisitionId: '' })], [j])[0].category, 'possible');
  assert.equal(previewPortal([row({ term: 'Winter 2027' })], [j])[0].category, 'possible');
  assert.equal(previewPortal([row()], [j, { ...j, key: 'b'.repeat(24) }])[0].category, 'possible');
  assert.equal(previewPortal([row({ company: 'Other', title: 'Unrelated', externalUrl: '', requisitionId: '' })], [j])[0].category, 'unmatched');
  const grouped = { ...j, url: 'https://example.com/primary', requisitionId: 'OTHER', groupedSources: [j] };
  assert.equal(previewPortal([row()], [grouped])[0].category, 'possible'); // conflicting primary is not silently accepted
});

test('repeat linking is idempotent; source updates preserve state, notes and materials; identities cannot be stolen', () => {
  let j = { ...linked(), notes: 'Keep my note', nextStep: 'Keep next step', materials: { resume: 'version1.pdf' } };
  assert.deepEqual(linkPortal(j, row(), [j], { confirmed: true }, now), j);
  const fresh = linkPortal(j, row({ deadline: '2026-10-10' }), [j], { confirmed: true }, now);
  assert.equal(fresh.portal.requirement, 'required'); assert.equal(fresh.notes, j.notes);
  assert.equal(fresh.nextStep, j.nextStep); assert.deepEqual(fresh.materials, j.materials);
  assert.throws(() => linkPortal({ ...job(), key: 'b'.repeat(24) }, row(), [j], { confirmed: true }, now));
  assert.throws(() => linkPortal(j, row({ id: 'OTHER' }), [j], { confirmed: true }, now));
  assert.throws(() => linkPortal(job(), row(), [], { confirmed: false }, now));
});

test('school and employer submissions have independent dates, receipts and frozen material snapshots', () => {
  const original = linked();
  const ready = { ...markReady(original, { resume: 'v1.pdf' }), materialVersion: { version: 'v1', sha256: 'abc' } };
  const external = markSubmitted(ready, '2026-09-27', true, now, 'E-123');
  assert.equal(external.portal.status, 'unknown'); assert.equal(external.externalSubmission.receipt, 'E-123');
  assert.equal(portalSummary(external, now).category, 'pending');
  const school = updatePortal(external, { action: 'submitted', confirmed: true, attachmentsConfirmed: true, date: '2026-09-28', materialSource: 'external', receipt: 'S-789' }, now);
  assert.equal(school.applicationDate, '2026-09-27'); assert.equal(school.portal.applicationDate, '2026-09-28');
  assert.deepEqual(school.portal.materials.version, ready.materialVersion);
  assert.equal(school.portal.receipt, 'S-789'); assert.equal(portalSummary(school, now).category, 'submitted');
  ready.materialVersion.version = 'v2'; ready.materials.resume = 'v2.pdf';
  assert.equal(external.externalSubmission.materials.version.version, 'v1');
  assert.equal(school.portal.materials.files.resume, 'v1.pdf');
  assert.throws(() => updatePortal(school, { action: 'requirement', confirmed: true, requirement: 'unknown' }, now));
  assert.throws(() => linkPortal(school, row({ deadline: '2026-10-10' }), [school], { confirmed: true }, now));
});

test('school-first submission is possible without marking employer submitted, and facts require explicit confirmation', () => {
  const j = linked();
  const input = { action: 'submitted', confirmed: true, attachmentsConfirmed: true, date: '2026-09-28', materialSource: 'other', materialNote: 'CS Sep 28 and transcript' };
  for (const invalid of [{ confirmed: false }, { date: '2026-09-29' }, { date: '2026-02-30' }, { materialNote: '' }, { materialSource: 'external' }]) {
    assert.throws(() => updatePortal(j, { ...input, ...invalid }, now));
  }
  const school = updatePortal(j, input, now);
  assert.equal(school.status, 'Queue'); assert.equal(school.applicationDate, null);
  assert.equal(school.portal.materials.note, input.materialNote);
});

test('unknown, not required, expired, and unlinked states do not masquerade as completed or actionable', () => {
  const j = markSubmitted(markReady(linked(), { resume: 'v1.pdf' }), '2026-09-27', true, now);
  assert.equal(portalSummary({ ...j, portal: null }, now).category, 'unlinked');
  assert.equal(portalSummary({ ...j, portal: { ...j.portal, requirement: 'unknown' } }, now).category, 'unknown');
  assert.equal(portalSummary({ ...j, portal: { ...j.portal, requirement: 'not-required' } }, now).category, 'not-required');
  assert.equal(portalSummary({ ...j, deadline: '2026-09-20' }, now).category, 'pending'); // school deadline is independent
  assert.equal(portalSummary({ ...j, portal: { ...j.portal, deadline: '2026-09-27' } }, now).category, 'expired');
  assert.equal(portalSummary({ ...job(), status: '已结束' }, now).externalSubmitted, false);
});

test('unlink retains a submitted school snapshot and permits a corrected link without altering employer history', () => {
  const submitted = updatePortal(linked(), { action: 'submitted', confirmed: true, attachmentsConfirmed: true, date: '2026-09-28', materialSource: 'other', materialNote: 'v1' }, now);
  const unlinked = updatePortal(submitted, { action: 'unlink', confirmed: true }, now);
  assert.equal(unlinked.portal, null); assert.equal(unlinked.portalHistory.at(-1).portal.status, 'submitted');
  const corrected = linkPortal(unlinked, row({ id: 'S999' }), [unlinked], { confirmed: true }, now);
  assert.equal(corrected.portal.id, 'S999'); assert.equal(corrected.portal.requirement, 'unknown');
  assert.notEqual(portalRevision(corrected), portalRevision(submitted));
  assert.equal(corrected.portalHistory[corrected.portalHistory.length - 2].portal.materials.note, 'v1');
});
