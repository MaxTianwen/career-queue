import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkspaceStore } from '../src/v2/store.mjs';

function fixture(t) {
  const database = resolve('output/test-runs', `v2-corrections-${randomUUID()}`, 'workspaces.sqlite');
  const store = new WorkspaceStore(database, { now: () => Date.parse('2026-10-04T16:00:00Z') });
  t.after(() => store.close());
  const owner = randomUUID(), other = randomUUID();
  for (const [id, username] of [[owner, 'synthetic_owner'], [other, 'synthetic_other']]) store.db.prepare('INSERT INTO users(id,username,salt,password_hash) VALUES (?,?,?,?)').run(id, username, 'fixture', 'fixture');
  const file = store.saveFile(owner, 'synthetic.pdf', Buffer.from('%PDF-1.7 synthetic fixture'));
  const parsed = store.saveParsed(owner, file.id, { text: 'Synthetic candidate: Python SQL data analysis and software development projects.', pages: 1, parser: 'fixture' });
  store.activateResume(owner, { ...parsed, confirmed: true });
  const job = store.saveJob(owner, { company: 'Synthetic Company', title: 'Intern', jd: 'Python SQL required', notes: 'Preserve this note' });
  store.setApplicationChannel(owner, job.id, { channel: 'both' });
  store.markPdfViewed(owner, file.id, 1, 'synthetic-session');
  const material = store.reviewMaterial(owner, job.id, { contextHash: store.materialContext(owner, job.id).hash, resumeFileId: file.id, confirmed: true }, 'synthetic-session').versions[0];
  const input = { channel: 'employer', materialId: material.id, date: '2026-10-02', receipt: 'Original receipt', confirmed: true, attachmentsComplete: true, requestId: randomUUID() };
  const original = store.recordSubmission(owner, job.id, input).submissions[0];
  const correction = { channel: 'school', date: '2026-10-03', receipt: 'Corrected receipt', reason: 'The original entry used the wrong channel and date.', revision: 0, requestId: randomUUID() };
  return { database, store, owner, other, file, job, material, input, original, correction };
}

test('v2 correction retains original evidence and material while applying the effective channel and date', t => {
  const f = fixture(t), initialBytes = Buffer.from(f.store.file(f.owner, f.file.id).bytes), baseline = f.store.activeResume(f.owner);
  f.store.saveJob(f.owner, { ...f.job, jd: 'Changed JD after the actual submission.' }, f.job.id);
  f.store.clearResume(f.owner);
  const result = f.store.correctSubmission(f.owner, f.job.id, f.original.id, f.correction), row = result.submissions[0];
  assert.equal(row.channel, 'school'); assert.equal(row.date, '2026-10-03'); assert.equal(row.receipt, 'Corrected receipt');
  assert.equal(row.materialId, f.original.materialId); assert.equal(row.created, f.original.created); assert.equal(row.revision, 1);
  assert.equal(row.corrections.length, 1); assert.equal(row.corrections[0].actor, 'synthetic_owner');
  assert.deepEqual(row.corrections[0].before, { channel: 'employer', date: f.original.date, receipt: f.original.receipt });
  assert.deepEqual(row.corrections[0].after, { channel: 'school', date: '2026-10-03', receipt: 'Corrected receipt' });
  assert.equal(result.complete, false); assert.equal(result.status, '还有渠道待处理');
  assert.deepEqual(result.versions[0].snapshot, f.material.snapshot);
  assert.deepEqual(Buffer.from(f.store.file(f.owner, f.file.id).bytes), initialBytes);
  assert.equal(f.store.activeResume(f.owner), null); assert.ok(baseline); assert.equal(f.store.job(f.owner, f.job.id).notes, 'Preserve this note');
  f.store.setApplicationChannel(f.owner, f.job.id, { channel: 'school-only' });
  assert.equal(f.store.application(f.owner, f.job.id).complete, true);
});

test('v2 correction rejects stale edits, conflicting channels, invalid dates and missing reasons without audit writes', t => {
  const f = fixture(t), correct = value => f.store.correctSubmission(f.owner, f.job.id, f.original.id, { ...f.correction, ...value });
  for (const bad of [{ reason: '  ' }, { reason: 'x'.repeat(501) }, { date: '2026-02-30' }, { date: '2026-10-05' }, { revision: -1 }, { revision: '0' }, { requestId: 'not-a-uuid' }, { channel: 'unknown' }, { channel: f.original.channel, date: f.original.date, receipt: f.original.receipt }]) assert.throws(() => correct(bad), { status: 400 });
  assert.throws(() => correct({ revision: 1 }), { status: 409 });
  f.store.setApplicationChannel(f.owner, f.job.id, { channel: 'employer' });
  assert.throws(() => correct({}), { status: 409 });
  f.store.setApplicationChannel(f.owner, f.job.id, { channel: 'both' });
  const school = f.store.recordSubmission(f.owner, f.job.id, { ...f.input, channel: 'school', requestId: randomUUID() }).submissions.find(row => row.channel === 'school');
  assert.throws(() => correct({}), { status: 409 });
  assert.deepEqual(f.store.application(f.owner, f.job.id).submissions, [f.original, school]);
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM submission_corrections').get().n, 0);
});

test('v2 correction retries remain idempotent after later revisions and competing stale writes fail', t => {
  const f = fixture(t), correct = value => f.store.correctSubmission(f.owner, f.job.id, f.original.id, value);
  const first = correct(f.correction);
  assert.deepEqual(correct(f.correction), first);
  assert.throws(() => correct({ ...f.correction, reason: 'Changed request payload' }), { status: 409 });
  assert.throws(() => correct({ ...f.correction, requestId: randomUUID(), date: '2026-10-01' }), { status: 409 });
  const secondInput = { ...f.correction, date: '2026-10-04', revision: 1, requestId: randomUUID(), reason: 'Corrected date from the actual receipt.' };
  const second = correct(secondInput);
  assert.equal(second.submissions[0].revision, 2);
  assert.deepEqual(correct(f.correction), second);
  assert.deepEqual(correct(secondInput), second);
  assert.equal(second.submissions[0].corrections.length, 2);
  assert.deepEqual(second.submissions[0].corrections[1].before, first.submissions[0].corrections[0].after);
});

test('v2 original submission retries cannot recreate a channel released by correction', t => {
  const f = fixture(t);
  const corrected = f.store.correctSubmission(f.owner, f.job.id, f.original.id, f.correction);
  assert.deepEqual(f.store.recordSubmission(f.owner, f.job.id, f.input), corrected);
  assert.throws(() => f.store.recordSubmission(f.owner, f.job.id, { ...f.input, receipt: 'Different content under the same request' }), { status: 409 });
  const legacy = { ...f.input }; delete legacy.requestId;
  assert.throws(() => f.store.recordSubmission(f.owner, f.job.id, legacy), { status: 409 });
  const result = f.store.recordSubmission(f.owner, f.job.id, { ...f.input, requestId: randomUUID() });
  assert.equal(result.submissions.length, 2); assert.equal(result.complete, true);
  assert.deepEqual(result.submissions.find(row => row.id === f.original.id), corrected.submissions[0]);
});

test('v2 correction ownership, job binding and export preserve private audit boundaries', t => {
  const f = fixture(t), otherJob = f.store.saveJob(f.owner, { company: 'Another Company', title: 'Intern' });
  assert.throws(() => f.store.correctSubmission(f.other, f.job.id, f.original.id, f.correction), { status: 404 });
  assert.throws(() => f.store.correctSubmission(f.owner, otherJob.id, f.original.id, f.correction), { status: 404 });
  assert.throws(() => f.store.correctSubmission(f.owner, f.job.id, randomUUID(), f.correction), { status: 404 });
  const corrected = f.store.correctSubmission(f.owner, f.job.id, f.original.id, f.correction);
  const own = f.store.exportData(f.owner), other = f.store.exportData(f.other);
  assert.equal(own.submissions[0].channel, 'school'); assert.equal(own.submissionCorrections.length, 1);
  assert.deepEqual(own.submissionCorrections[0].before, corrected.submissions[0].corrections[0].before);
  assert.deepEqual(own.submissionCorrections[0].after, corrected.submissions[0].corrections[0].after);
  assert.equal(own.submissionCorrections[0].actor, 'synthetic_owner');
  assert.deepEqual(other.submissionCorrections, []); assert.deepEqual(other.submissions, []);
  assert.equal('password_hash' in own.account, false);
});

test('v2 correction and effective-record update roll back together on a write failure', t => {
  const f = fixture(t);
  f.store.db.exec("CREATE TRIGGER synthetic_correction_failure BEFORE UPDATE ON submissions BEGIN SELECT RAISE(ABORT, 'Synthetic write failure'); END;");
  assert.throws(() => f.store.correctSubmission(f.owner, f.job.id, f.original.id, f.correction), /Synthetic write failure/);
  assert.deepEqual(f.store.application(f.owner, f.job.id).submissions, [f.original]);
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM submission_corrections').get().n, 0);
  f.store.db.exec('DROP TRIGGER synthetic_correction_failure');
  assert.equal(f.store.correctSubmission(f.owner, f.job.id, f.original.id, f.correction).submissions[0].revision, 1);
});

test('v2 existing databases add correction support without changing submissions or material history', t => {
  const f = fixture(t);
  f.store.db.exec('DROP TABLE submission_corrections; DROP INDEX submissions_request; ALTER TABLE submissions DROP COLUMN request_id; ALTER TABLE submissions DROP COLUMN request_hash;');
  const before = f.store.db.prepare('SELECT * FROM submissions').all();
  const upgraded = new WorkspaceStore(f.database, { now: () => Date.parse('2026-10-04T16:00:00Z') }); t.after(() => upgraded.close());
  assert.deepEqual(upgraded.db.prepare('SELECT id,user_id,job_id,channel,material_id,submitted_date,receipt,created FROM submissions').all(), before);
  assert.equal(upgraded.application(f.owner, f.job.id).submissions[0].revision, 0);
  const result = upgraded.correctSubmission(f.owner, f.job.id, f.original.id, f.correction);
  const reopened = new WorkspaceStore(f.database, { now: () => Date.parse('2026-10-04T16:00:00Z') }); t.after(() => reopened.close());
  assert.deepEqual(reopened.application(f.owner, f.job.id), result);
  assert.equal(reopened.db.prepare('PRAGMA foreign_key_check').all().length, 0);
});

test('submitted identities match application rows for recorded submissions and stay owner-scoped', t => {
  const f = fixture(t), unsubmitted = f.store.saveJob(f.owner, { company: 'Synthetic Other', title: 'Intern', jd: 'Python' });
  const fromApplications = owner => new Set(f.store.applications(owner).map(row => row.jobId));
  assert.deepEqual(f.store.submittedIdentities(f.owner).jobIds, fromApplications(f.owner));
  assert.ok(f.store.submittedIdentities(f.owner).jobIds.has(f.job.id));
  assert.ok(!f.store.submittedIdentities(f.owner).jobIds.has(unsubmitted.id));
  assert.equal(f.store.submittedIdentities(f.other).jobIds.size, 0);
});
