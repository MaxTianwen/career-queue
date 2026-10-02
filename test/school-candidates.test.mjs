import test from 'node:test';
import assert from 'node:assert/strict';
import { schoolCandidate, completeSchoolCandidate } from '../src/school-candidates.mjs';
import { matchJob, buildProfile } from '../src/matching.mjs';
import { requireAvailable } from '../src/assessment.mjs';
import { prepare, complete } from '../src/pipeline.mjs';
import { DemoStore } from '../src/demo-store.mjs';
import { NotionStore } from '../src/notion.mjs';

const row = { id: 'S9001', company: 'Synthetic School Employer', title: 'Software Developer Co-op', term: 'Summer 2027', location: 'Toronto', deadline: '2026-10-05' };
test('unmatched school candidate has stable identity, no fake JD/URL or employer deadline and repeat import preserves it', () => {
  const job = schoolCandidate(row, []);
  assert.equal(job.jd, ''); assert.equal(job.url, null); assert.equal(job.deadline, null);
  assert.equal(job.portal.deadline, row.deadline); assert.equal(job.status, 'Queue');
  assert.equal(job.portal.status, 'unknown'); assert.equal(job.applicationDate, null);
  assert.equal(schoolCandidate(row, []).key, job.key);
  const edited = { ...job, notes: 'Keep my notes', status: '已归档' };
  assert.deepEqual(schoolCandidate(row, [edited]), edited);
  assert.throws(() => schoolCandidate(row, [{ ...job, portal: null }]), /已存在/);
});

test('missing school JD cannot score, prepare or upload application materials', async () => {
  const job = schoolCandidate(row, []), store = new DemoStore(); await store.create(job);
  assert.equal(matchJob(job, buildProfile('Python SQL')).score, null);
  assert.throws(() => requireAvailable(job), /完整 JD/);
  await assert.rejects(prepare(store, job.key, 'not-read', 'not-written'), /完整 JD/);
  await assert.rejects(complete(store, job.key, {}, true), /完整 JD/);
});

test('JD completion preserves school deadline, saved notes, application key and independent state', () => {
  const job = { ...schoolCandidate(row, []), notes: 'Keep me', nextStep: 'Ask hiring manager' };
  const details = { url: 'https://example.com/jobs/123', jd: 'Python required. Duration: 8 months. Work mode: hybrid.' };
  const next = completeSchoolCandidate(job, details, [job]);
  assert.equal(next.key, job.key); assert.deepEqual(next.portal, job.portal); assert.deepEqual(next.portalHistory, job.portalHistory);
  assert.equal(next.notes, job.notes); assert.equal(next.nextStep, job.nextStep);
  assert.equal(next.fullJd, true); assert.equal(next.schoolCandidate, false); assert.equal(next.term, 'Summer 2027');
  assert.equal(next.deadline, null); assert.equal(next.durationMonths, 8); assert.equal(next.applicationDate, null);
  assert.throws(() => completeSchoolCandidate(job, details, [job, { key: 'other', url: details.url }]), /已在 Queue/);
  assert.throws(() => completeSchoolCandidate(next, details, [next]), /仅待补/);
  assert.throws(() => completeSchoolCandidate(job, { url: 'javascript:alert(1)', jd: 'Test' }, [job]));
});

test('Notion JD completion patches source fields atomically without overwriting notes or application state', async () => {
  const store = Object.create(NotionStore.prototype), requests = [];
  store.request = async (...args) => { requests.push(args); return {}; };
  const job = completeSchoolCandidate({ ...schoolCandidate(row, []), pageId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }, { url: 'https://example.com/jobs/123', jd: 'Python required.' }, []);
  await store.updateJob(job);
  assert.equal(requests.length, 1);
  const properties = requests[0][2].properties;
  assert.equal(properties.URL.url, job.url); assert.equal(properties.Notes, undefined); assert.equal(properties.Status, undefined);
  const payload = JSON.parse(properties.Payload.rich_text.map(t => t.text.content).join(''));
  assert.equal(payload.jd, job.jd); assert.equal(payload.portal.deadline, row.deadline);
});
