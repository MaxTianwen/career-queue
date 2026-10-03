import test from 'node:test';
import assert from 'node:assert/strict';
import { schoolCandidate, completeSchoolCandidate, schoolAssociation } from '../src/school-candidates.mjs';
import { normalizeJob } from '../src/core.mjs';
import { availabilityState, requireAvailable, assessJob } from '../src/assessment.mjs';
import { extractDeadline } from '../src/deadlines.mjs';
import { buildResumeProfile, matchJob } from '../src/matching.mjs';
import { NotionStore } from '../src/notion.mjs';
import { DemoStore } from '../src/demo-store.mjs';
import { prepare, complete } from '../src/pipeline.mjs';
const row = { id: 'S-JD-1', company: 'Synthetic School Employer', title: 'Software Developer Co-op', term: 'Summer 2027', location: 'Ottawa, ON', deadline: '2027-01-10' };
const details = { jdSource: 'school', url: '', jd: 'Required: Python and REST API. Duration: 4 months. Work mode: hybrid. Application deadline: January 10, 2027.' };
const candidate = () => ({ ...schoolCandidate(row, []), notes: 'Keep notes', nextStep: 'Read requirements' });
test('school JD can be saved without an invented URL, with stable identity and separate school dates', () => {
  const original = candidate(), other = schoolCandidate({ ...row, id: 'S-JD-2' }, []);
  const job = completeSchoolCandidate(original, details, [original, other]);
  assert.equal(job.key, original.key); assert.equal(job.url, null); assert.equal(job.fullJd, true); assert.equal(job.schoolCandidate, false);
  assert.equal(job.jdSource, 'school'); assert.equal(job.schoolJd.text, details.jd); assert.equal(job.schoolJd.schoolId, row.id);
  assert.deepEqual(job.portal, original.portal); assert.equal(job.notes, original.notes); assert.equal(job.status, 'Queue'); assert.equal(job.applicationDate, null);
  assert.equal(job.deadline, null); assert.equal(extractDeadline(job).deadline, null); assert.equal(job.postedAt, null);
  assert.equal(job.decision, 'REJECT'); assert.match(job.reasons.join(' '), /至少 8/);
  assert.equal(typeof matchJob(job, buildResumeProfile('Built Python and REST API projects with automated tests and documentation for university coursework.', { track: 'cs', version: 'synthetic-v1' })).score, 'number');
  assert.deepEqual(schoolCandidate(row, [job]), job); assert.equal(schoolAssociation(job, '', [job, other]), null);
  assert.throws(() => normalizeJob({ ...details, company: row.company, title: row.title }), /url/);
});
test('school JD needs explicit source, nonempty body and an uncompleted school record', () => {
  const c = candidate();
  for (const d of [{ ...details, jd: ' ' }, { ...details, jdSource: undefined }, { ...details, url: 'https://example.com/job' }]) assert.throws(() => completeSchoolCandidate(c, d, [c]));
  assert.throws(() => completeSchoolCandidate({ ...c, portal: null }, details, []));
  const job = completeSchoolCandidate(c, details, []);
  assert.throws(() => completeSchoolCandidate(job, details, [job]));
});
test('adding an official link keeps school text and identity; duplicate applications still require explicit association', () => {
  const job = completeSchoolCandidate(candidate(), details, []);
  const url = 'https://example.com/jobs/verified';
  const next = completeSchoolCandidate(job, { url, jd: 'Python required. Duration: 8 months. Work mode: hybrid.' }, [job]);
  assert.equal(next.key, job.key); assert.equal(next.url, url); assert.notEqual(next.jdSource, 'school');
  assert.deepEqual(next.schoolJd, job.schoolJd); assert.deepEqual(next.portal, job.portal); assert.equal(next.notes, job.notes);
  const target = { key: 'target', company: job.company, title: job.title, term: job.term, url, fullJd: true, status: 'Queue' };
  assert.deepEqual(schoolAssociation(job, url, [job, target]).conflicts, []);
  assert.throws(() => completeSchoolCandidate(job, { url, jd: 'Python' }, [job, target]), /已在 Queue/);
  assert.ok(schoolAssociation({ ...job, portal: { ...job.portal, status: 'submitted' } }, url, [job, target]).conflicts.length);
});
test('school JD cannot claim official availability or use material pipelines without a link', async () => {
  const job = completeSchoolCandidate(candidate(), details, []);
  job.availability = { status: 'open', checkedAt: new Date().toISOString(), manual: { note: 'not enough' } };
  assert.equal(availabilityState(job).status, 'unknown'); assert.throws(() => requireAvailable(job), /学校来源/);
  const store = new DemoStore(); await store.create(job);
  await assert.rejects(prepare(store, job.key, 'not-read', 'not-written'), /学校来源/);
  await assert.rejects(complete(store, job.key, {}, true), /学校来源/);
});
test('Notion persists a school JD without URL and without overwriting notes or submission state', async () => {
  const job = completeSchoolCandidate({ ...candidate(), pageId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }, details, []);
  const store = Object.create(NotionStore.prototype); let properties;
  store.request = async (_, __, body) => { properties = body.properties; return {}; };
  await store.updateJob(job);
  assert.equal(properties.URL.url, null); assert.equal(properties.Notes, undefined); assert.equal(properties.Status, undefined);
  const saved = JSON.parse(properties.Payload.rich_text.map(t => t.text.content).join(''));
  assert.equal(saved.jdSource, 'school'); assert.deepEqual(saved.schoolJd, job.schoolJd); assert.deepEqual(saved.portal, job.portal);
});

 test('school JD assessments follow the current resume version and never require a website URL', () => {
  const job = completeSchoolCandidate(candidate(), details, []);
  const profiles = version => Object.fromEntries(['cs', 'data'].map(track => [track, buildResumeProfile(version === 'v1' ? 'Built Python and REST API projects with automated tests and documentation.' : 'Worked with SQL and Tableau to create business reporting and dashboards.', { track, version })]));
  const first = assessJob(job, profiles('v1')), second = assessJob(job, profiles('v2'));
  assert.equal(first.match.source.version, 'v1'); assert.equal(second.match.source.version, 'v2');
  assert.notEqual(first.assessment.id, second.assessment.id); assert.ok(first.match.score > second.match.score);
 });
