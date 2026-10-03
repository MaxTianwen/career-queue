import test from 'node:test';
import assert from 'node:assert/strict';
import * as assessment from '../src/assessment.mjs';
import { schoolCandidate, completeSchoolCandidate } from '../src/school-candidates.mjs';
import { buildResumeProfile } from '../src/matching.mjs';
import { prepareResumeDraft } from '../src/resume.mjs';
import { assessmentPanel } from '../web/assessment-view.js';

const now = new Date('2026-10-03T17:00:00Z');
const job = () => completeSchoolCandidate(schoolCandidate({ id: 'S-15', company: 'Synthetic', title: 'Software Intern', location: 'Toronto', term: 'Summer 2027', deadline: '2027-01-10' }, []),
  { jdSource: 'school', jd: 'Required: Python and SQL. Duration: 8 months. Work mode: hybrid.' }, []);
const confirm = (record, at = now) => ({ ...record, schoolAvailability: assessment.confirmSchoolAvailability(record, { confirmed: true, note: 'Checked the school Apply entry', inputHash: assessment.schoolInputHash(record) }, at) });
const profiles = Object.fromEntries(['cs','data'].map(track => [track, buildResumeProfile('Built Python and SQL projects and tested software applications.', { track, version: 'synthetic-v1' })]));

test('school confirmation lasts 15 minutes without claiming official availability', () => {
  const original = job(), saved = confirm(original);
  assert.throws(() => assessment.requireAvailable(original, now), /学校/);
  assert.doesNotThrow(() => assessment.requireAvailable(saved, new Date(now.getTime() + 15 * 60000)));
  assert.throws(() => assessment.requireAvailable(saved, new Date(now.getTime() + 15 * 60000 + 1)), /学校/);
  assert.throws(() => assessment.requireAvailable(saved, new Date(now.getTime() - 1)), /学校/);
  assert.equal(assessment.availabilityState(saved, now).status, 'unknown');
  assert.equal(assessment.schoolAvailabilityState(saved, now).recent, true);
  assert.equal(saved.status, original.status); assert.deepEqual(saved.portal, original.portal);
});

test('school confirmation cannot be reused for a changed identity, JD, deadline or incomplete posting', () => {
  const saved = confirm(job());
  for (const changes of [{ key: 'b'.repeat(24) }, { jd: saved.jd + ' New condition' }, { fullJd: false }, { portal: null },
    { portal: { ...saved.portal, id: 'S-other' } }, { portal: { ...saved.portal, deadline: '2027-01-11' } },
    { portal: { ...saved.portal, deadlineText: 'Changed school date' } }, { status: '已归档' }]) {
    assert.throws(() => assessment.requireAvailable({ ...saved, ...changes }, now));
  }
  const expired = { ...job(), portal: { ...job().portal, deadline: '2026-10-02' } };
  assert.throws(() => confirm(expired), /截止/);
  for (const values of [{ confirmed: false }, { note: '' }, { inputHash: 'old' }]) assert.throws(() => assessment.confirmSchoolAvailability(job(), { confirmed: true, note: 'Checked', inputHash: assessment.schoolInputHash(job()), ...values }, now));
  assert.throws(() => confirm({ ...job(), url: 'https://example.com/job' }));
});

test('school assessment and material provenance bind school context without changing the coverage score', () => {
  const record = confirm(job());
  const first = assessment.assessJob(record, profiles, now);
  const changed = assessment.assessJob({ ...record, portal: { ...record.portal, deadline: '2027-01-11' } }, profiles, now);
  assert.equal(first.match.score, changed.match.score); assert.notEqual(first.assessment.id, changed.assessment.id);
  assert.equal(assessment.materialFreshness({ assessment: first.assessment }, changed.assessment).status, 'stale');
  const snapshot = assessment.assessmentSnapshot(record, first);
  assert.equal(snapshot.job.jdSource, 'school'); assert.equal(snapshot.job.schoolId, record.portal.id);
  assert.deepEqual(snapshot.job.schoolAvailability, record.schoolAvailability);
  assert.equal(snapshot.job.schoolDeadline, record.portal.deadline);
});

test('school draft direct entry rejects unconfirmed jobs before accessing any resume files', async () => {
  await assert.rejects(prepareResumeDraft('output/nonexistent-school-materials', job(), 'cs'), /学校/);
});

test('school confirmation UI is separate from official status and escapes evidence', () => {
  const record = job(); record.assessment = assessment.assessJob(record, profiles, now).assessment;
  record.schoolAvailabilityView = assessment.schoolAvailabilityState(record, now);
  assert.match(assessmentPanel(record), /school-availability-confirm-form/);
  assert.doesNotMatch(assessmentPanel(record), /data-action="recheck-availability"/);
  const saved = confirm(record); saved.schoolAvailability.note = '<script>school</script>';
  saved.schoolAvailabilityView = assessment.schoolAvailabilityState(saved, now);
  assert.match(assessmentPanel(saved), /&lt;script&gt;/);
  assert.doesNotMatch(assessmentPanel(saved), /官方岗位仍开放/);
});
