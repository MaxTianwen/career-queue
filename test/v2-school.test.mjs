import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { WorkspaceStore } from '../src/v2/store.mjs';
import { catalogueJob } from '../src/v2/catalogue.mjs';

const source = { id: 'synthetic', name: 'Example Labs', url: 'https://example.com/careers' };
const raw = { company: 'Example Labs', title: 'Software Developer Intern', location: 'Toronto, ON', url: 'https://example.com/jobs/JR900099', jd: 'Python software development internship. Four months, Summer 2027.', requisitionId: 'JR900099', term: 'Summer 2027' };
const header = ['', 'App Status', 'Term', 'ID', 'Job Title', 'Organization', 'Openings', 'Location', 'App Deadline', ''];
const schoolRow = (id = '900001', title = 'NEW Software Developer Intern - JR900099') => ['Shortlist Apply', 'Applied', '2027 - Summer', id, title, 'Example Labs', '1', 'Toronto, ON', 'Oct 31, 2026 11:59 PM', ''];
const paste = (...rows) => [header, ...rows].map(row => row.join('\t')).join('\n');
function fixture(t) {
  const database = resolve('output/test-runs', `v2-school-${randomUUID()}`, 'workspace.sqlite');
  const store = new WorkspaceStore(database, { now: () => Date.parse('2026-10-04T16:00:00Z') }); t.after(() => store.close());
  const owner = randomUUID(), other = randomUUID();
  for (const [id, username] of [[owner, 'school_user'], [other, 'other_user']]) store.db.prepare('INSERT INTO users(id,username,salt,password_hash) VALUES (?,?,?,?)').run(id, username, 'test', 'test');
  const job = catalogueJob(raw, source);
  store.saveCatalogue({ jobs: [job], sources: [{ ...source, status: 'complete' }], finishedAt: '2026-10-04T14:00:00Z' });
  const input = (text, selections) => ({ text, selections, fingerprint: store.schoolPreview(owner, text).fingerprint, requestId: randomUUID(), confirmed: true });
  return { store, database, owner, other, job, input };
}

test('v2 school preview retains requisitions and finds preference-hidden candidates without importing source statuses', t => {
  const f = fixture(t); f.store.preferences(f.owner, { locations: 'Vancouver' });
  const text = paste(schoolRow()), result = f.store.schoolPreview(f.owner, text);
  assert.equal(f.job.requisitionId, raw.requisitionId); assert.equal(result.rows[0].row.sourceStatus, 'Applied');
  assert.equal(result.rows[0].row.deadline, '2026-10-31T23:59:00-04:00');
  assert.match(result.rows[0].candidates[0].sourceNote, /当前偏好/);
  assert.equal(result.rows[0].candidates[0].strong, true);
  assert.deepEqual(f.store.jobs(f.owner), []); assert.deepEqual(f.store.schoolLinks(f.owner), []);
  const saved = f.store.importSchool(f.owner, f.input(text, [{ index: 0, target: `catalogue:${f.job.id}` }]));
  const app = f.store.application(f.owner, saved.saved[0].jobId);
  assert.deepEqual(app.submissions, []); assert.equal(app.channel, 'unknown'); assert.equal(app.context.job.jd, raw.jd);
});

test('v2 linking school rows preserves saved notes, JD, channel, materials and submission history', t => {
  const f = fixture(t), job = f.store.saveJob(f.owner, { ...raw, notes: 'Keep private notes', jd: 'My reviewed JD' });
  f.store.setApplicationChannel(f.owner, job.id, { channel: 'both' });
  const before = f.store.application(f.owner, job.id), text = paste(schoolRow());
  const result = f.store.schoolPreview(f.owner, text); assert.equal(result.rows[0].candidates.length, 1);
  assert.equal(result.rows[0].candidates[0].target, `saved:${job.id}`);
  const input = f.input(text, [{ index: 0, target: `saved:${job.id}` }]);
  f.store.importSchool(f.owner, input);
  assert.deepEqual({ ...f.store.job(f.owner, job.id) }, { ...job, schoolId: '900001' }); assert.deepEqual(f.store.application(f.owner, job.id), before);
  assert.equal(f.store.schoolRecords(f.owner)[0].row.id, '900001');
  assert.equal(f.store.schoolPreview(f.owner, text).rows[0].category, 'linked');
});

test('v2 unmatched school candidates stay private, unscored and without invented official links or JD', t => {
  const f = fixture(t), row = schoolRow('900002', 'Intercept Support Specialist Co-Op'); row[5] = 'Uncovered Employer';
  const text = paste(row), preview = f.store.schoolPreview(f.owner, text);
  assert.equal(preview.rows[0].category, 'unmatched');
  const { saved } = f.store.importSchool(f.owner, f.input(text, [{ index: 0, target: 'new' }]));
  const job = f.store.job(f.owner, saved[0].jobId);
  assert.equal(job.url, ''); assert.equal(job.jd, ''); assert.equal(f.store.application(f.owner, job.id).context.ready, false);
  assert.deepEqual(f.store.schoolLinks(f.other), []); assert.deepEqual(f.store.exportData(f.other).schoolLinks, []);
  assert.equal(f.store.exportData(f.owner).schoolLinks[0].row.sourceStatus, 'Applied');
});

test('v2 school imports reject stale previews and retries preserve the same saved IDs across restarts', t => {
  const f = fixture(t), text = paste(schoolRow()), input = f.input(text, [{ index: 0, target: 'new' }]);
  f.store.saveJob(f.owner, { company: 'Added since preview', title: 'Another job' });
  assert.throws(() => f.store.importSchool(f.owner, input), { status: 409 });
  input.fingerprint = f.store.schoolPreview(f.owner, text).fingerprint;
  const first = f.store.importSchool(f.owner, input);
  const reopened = new WorkspaceStore(f.database); t.after(() => reopened.close());
  assert.deepEqual(reopened.importSchool(f.owner, input), first);
  assert.equal(reopened.schoolLinks(f.owner).length, 1);
  assert.throws(() => reopened.importSchool(f.owner, { ...input, selections: [{ index: 0, target: `catalogue:${f.job.id}` }] }), { status: 409 });
});

test('v2 repeated school data and changed source fields never overwrite links or original school deadlines', t => {
  const f = fixture(t), text = paste(schoolRow());
  f.store.importSchool(f.owner, f.input(text, [{ index: 0, target: 'new' }]));
  const original = f.store.schoolLinks(f.owner);
  const updated = schoolRow(); updated[8] = 'Nov 30, 2026 11:59 PM';
  const changed = paste(updated), preview = f.store.schoolPreview(f.owner, changed);
  assert.equal(preview.rows[0].sourceChanged, true);
  assert.throws(() => f.store.importSchool(f.owner, f.input(changed, [{ index: 0, target: 'new' }])), { status: 409 });
  assert.deepEqual(f.store.schoolLinks(f.owner), original);
});

test('v2 school import conflicts roll back the entire batch including newly created jobs', t => {
  const f = fixture(t), job = f.store.saveJob(f.owner, raw), firstText = paste(schoolRow());
  f.store.importSchool(f.owner, f.input(firstText, [{ index: 0, target: `saved:${job.id}` }]));
  const text = paste(schoolRow('900002'), schoolRow('900003'));
  assert.throws(() => f.store.importSchool(f.owner, f.input(text, [{ index: 0, target: 'new' }, { index: 1, target: `saved:${job.id}` }])), { status: 409 });
  assert.equal(f.store.jobs(f.owner).length, 1); assert.equal(f.store.schoolLinks(f.owner).length, 1);
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM school_imports').get().n, 1);
});

test('v2 school imports validate choices, reject foreign accounts and preserve duplicate school ID warnings', t => {
  const f = fixture(t), foreign = f.store.saveJob(f.other, raw), text = paste(schoolRow()), input = f.input(text, [{ index: 0, target: 'new' }]);
  assert.throws(() => f.store.importSchool(f.owner, { ...input, confirmed: false }), { status: 400 });
  assert.throws(() => f.store.importSchool(f.owner, { ...input, selections: [{ index: 0, target: `saved:${foreign.id}` }] }), { status: 404 });
  assert.throws(() => f.store.importSchool(f.owner, { ...input, selections: [{ index: 0, target: 'new' }, { index: 0, target: 'new' }] }), { status: 400 });
  assert.throws(() => f.store.schoolPreview(f.owner, 'No table'), { status: 400 });
  const duplicates = f.store.schoolPreview(f.owner, paste(schoolRow(), schoolRow()));
  assert.equal(duplicates.rows[1].category, 'invalid'); assert.equal(duplicates.warnings.length > 0, true);
  assert.deepEqual(f.store.jobs(f.owner), []);
});

test('v2 school preview keeps invalid deadlines visible and rejects unsafe school links', t => {
  const f = fixture(t), row = schoolRow(); row[8] = 'Unknown deadline';
  const parsed = f.store.schoolPreview(f.owner, paste(row));
  assert.equal(parsed.rows[0].row.deadline, ''); assert.match(parsed.rows[0].warning, /截止/);
  row[4] = '[Software Developer Intern](http://school.example/900001)';
  assert.equal(f.store.schoolPreview(f.owner, paste(row)).rows[0].category, 'invalid');
});

function linked(f, id = '900001', target) {
  const text = paste(schoolRow(id));
  f.store.importSchool(f.owner, f.input(text, [{ index: 0, target: target ? `saved:${target.id}` : 'new' }]));
  return f.store.schoolLinks(f.owner).find(row => row.schoolId === id);
}
function maintenance(f, link, action, extra = {}) {
  const input = { action, revision: link.revision, ...extra };
  const plan = f.store.schoolChangePreview(f.owner, link.schoolId, input);
  return { ...input, fingerprint: plan.fingerprint, confirmed: true, reason: 'Correct synthetic school information', requestId: randomUUID() };
}
function submission(f, jobId, channel) {
  f.store.setApplicationChannel(f.owner, jobId, { channel: 'both' });
  const material = randomUUID(), context = f.store.materialContext(f.owner, jobId);
  f.store.db.prepare('INSERT INTO materials VALUES (?,?,?,?,?,?)').run(material, f.owner, jobId, material, JSON.stringify({ context }), f.store.now());
  return f.store.recordSubmission(f.owner, jobId, { channel, schoolRevision: f.store.schoolContext(f.owner, jobId)?.revision ?? null, materialId: material, date: '2026-01-01', confirmed: true, attachmentsComplete: true }).submissions.find(row => row.channel === channel);
}

test('school maintenance permits employer-submitted relink and unlink without moving job, material or application history', t => {
  const f = fixture(t), link = linked(f), second = f.store.saveJob(f.owner, { ...raw, title: 'Correct target', notes: 'Target notes' });
  submission(f, link.jobId, 'employer');
  const before = f.store.application(f.owner, link.jobId), jobs = f.store.jobs(f.owner);
  assert.equal(f.store.schoolRecords(f.owner)[0].locked, false);
  f.store.changeSchool(f.owner, link.schoolId, maintenance(f, link, 'relink', { targetJobId: second.id }));
  const current = f.store.schoolLinks(f.owner)[0]; assert.equal(current.jobId, second.id);
  assert.deepEqual(f.store.jobs(f.owner).map(job => ({ ...job })), jobs.map(job => ({ ...job, schoolId: job.id === second.id ? link.schoolId : null })));
  assert.deepEqual(f.store.application(f.owner, link.jobId), before);
  f.store.changeSchool(f.owner, link.schoolId, maintenance(f, current, 'unlink'));
  assert.deepEqual(f.store.schoolLinks(f.owner), []);
  assert.deepEqual(f.store.jobs(f.owner).map(job => ({ ...job })), jobs.map(job => ({ ...job, schoolId: null }))); assert.deepEqual(f.store.application(f.owner, link.jobId), before);
  assert.deepEqual(f.store.schoolHistory(f.owner).map(row => row.action), ['link', 'relink', 'unlink']);
  assert.equal(f.store.schoolHistory(f.owner)[2].before.jobId, second.id);
});

test('only matching School ID actual school submission locks unlink/relink and keeps a frozen source on updates', t => {
  const f = fixture(t), link = linked(f), record = submission(f, link.jobId, 'school'), before = f.store.application(f.owner, link.jobId);
  assert.equal(f.store.schoolRecords(f.owner)[0].locked, true);
  for (const action of ['unlink', 'relink']) assert.throws(() => maintenance(f, link, action), { status: 409 });
  const input = maintenance(f, link, 'update', { row: { ...link.row, deadlineText: 'Nov 30, 2026 11:59 PM' } });
  f.store.changeSchool(f.owner, link.schoolId, input);
  assert.equal(f.store.schoolLinks(f.owner)[0].row.deadline, '2026-11-30T23:59:00-05:00');
  const source = f.store.schoolSubmissionSources(f.owner)[0]; assert.equal(source.submissionId, record.id);
  assert.deepEqual(source.row, link.row); assert.equal(source.basis, 'submission');
  assert.deepEqual(f.store.application(f.owner, link.jobId), before);
});

test('school maintenance rejects concurrent actual submission even after unlocked unlink preview', t => {
  const f = fixture(t), link = linked(f), input = maintenance(f, link, 'unlink');
  submission(f, link.jobId, 'school');
  assert.throws(() => f.store.changeSchool(f.owner, link.schoolId, input), { status: 409 });
  assert.equal(f.store.schoolHistory(f.owner).length, 1); assert.equal(f.store.schoolLinks(f.owner).length, 1);
});

test('school maintenance retry survives unlink, reimport and restart without repeating or applying old mutations', t => {
  const f = fixture(t), link = linked(f), input = maintenance(f, link, 'unlink');
  f.store.changeSchool(f.owner, link.schoolId, input);
  const replacement = linked(f), before = f.store.schoolLinks(f.owner);
  assert.notEqual(replacement.revision, link.revision);
  f.store.changeSchool(f.owner, link.schoolId, input); assert.deepEqual(f.store.schoolLinks(f.owner), before);
  assert.throws(() => f.store.changeSchool(f.owner, link.schoolId, { ...input, requestId: randomUUID() }), { status: 409 });
  const reopened = new WorkspaceStore(f.database); t.after(() => reopened.close());
  reopened.changeSchool(f.owner, link.schoolId, input); assert.deepEqual(reopened.schoolLinks(f.owner), before);
  assert.throws(() => reopened.changeSchool(f.owner, link.schoolId, { ...input, reason: 'Different' }), { status: 409 });
});

test('school source updates validate explicit fields, safe URLs, unchanged identity and no-op; incomplete edits never clear data', t => {
  const f = fixture(t), link = linked(f);
  for (const row of [link.row, { ...link.row, id: '999' }, { ...link.row, url: 'javascript:alert(1)' }, { ...link.row, deadlineText: 'not a date' }, { title: 'Partial' }]) {
    assert.throws(() => maintenance(f, link, 'update', { row }), { status: 400 });
  }
  const input = maintenance(f, link, 'update', { row: { ...link.row, location: 'Markham, ON' } });
  for (const bad of [{ reason: '' }, { confirmed: false }]) assert.throws(() => f.store.changeSchool(f.owner, link.schoolId, { ...input, ...bad }), { status: 400 });
  assert.throws(() => f.store.changeSchool(f.other, link.schoolId, input), { status: 404 });
  f.store.changeSchool(f.owner, link.schoolId, input);
  assert.throws(() => f.store.changeSchool(f.owner, link.schoolId, { ...input, requestId: randomUUID() }), { status: 409 });
  assert.deepEqual(f.store.schoolHistory(f.other), []);
});

test('school relink rejects occupied and foreign targets and rolls audit back on write failure', t => {
  const f = fixture(t), link = linked(f), other = linked(f, '900002'), foreign = f.store.saveJob(f.other, raw);
  assert.throws(() => maintenance(f, link, 'relink', { targetJobId: other.jobId }), { status: 409 });
  assert.throws(() => maintenance(f, link, 'relink', { targetJobId: foreign.id }), { status: 404 });
  const input = maintenance(f, link, 'update', { row: { ...link.row, location: 'Markham' } });
  f.store.db.exec("CREATE TRIGGER fail_school_update BEFORE UPDATE ON school_links BEGIN SELECT RAISE(ABORT, 'Synthetic write failure'); END");
  assert.throws(() => f.store.changeSchool(f.owner, link.schoolId, input), /Synthetic write failure/);
  assert.equal(f.store.schoolHistory(f.owner).length, 2); assert.deepEqual(f.store.schoolLinks(f.owner)[0], link);
});

test('school source identity survives channel corrections and is not reassigned to a different School ID', t => {
  const f = fixture(t), link = linked(f), record = submission(f, link.jobId, 'school');
  const correction = { channel: 'employer', date: record.date, receipt: '', reason: 'Wrong channel', revision: 0, requestId: randomUUID() };
  f.store.correctSubmission(f.owner, link.jobId, record.id, correction);
  assert.equal(f.store.schoolRecords(f.owner)[0].locked, false);
  f.store.changeSchool(f.owner, link.schoolId, maintenance(f, link, 'unlink'));
  const replacement = linked(f, '900002', f.store.job(f.owner, link.jobId));
  f.store.correctSubmission(f.owner, link.jobId, record.id, { ...correction, channel: 'school', revision: 1, requestId: randomUUID() });
  assert.equal(f.store.schoolSubmissionSources(f.owner)[0].schoolId, '900001');
  assert.equal(f.store.schoolRecords(f.owner)[0].locked, false);
  assert.deepEqual(f.store.schoolRecords(f.owner)[0].submissions, []);
  assert.match(f.store.schoolRecords(f.owner)[0].status, /当前 School ID 尚无/);
  f.store.changeSchool(f.owner, replacement.schoolId, maintenance(f, replacement, 'unlink'));
  const text = paste(schoolRow());
  assert.throws(() => f.store.importSchool(f.owner, f.input(text, [{ index: 0, target: 'new' }])), { status: 409 });
});

test('later school association records when identity became known without rewriting an earlier submission', t => {
  const f = fixture(t), job = f.store.saveJob(f.owner, raw); submission(f, job.id, 'school');
  const before = f.store.application(f.owner, job.id); linked(f, '900001', job);
  const source = f.store.schoolSubmissionSources(f.owner)[0]; assert.equal(source.basis, 'confirmed-association');
  assert.equal(f.store.schoolRecords(f.owner)[0].locked, true); assert.deepEqual(f.store.application(f.owner, job.id), before);
  assert.equal(f.store.exportData(f.owner).schoolSubmissionSources.length, 1); assert.equal(f.store.exportData(f.owner).schoolHistory.length, 1);
  assert.deepEqual(f.store.exportData(f.other).schoolSubmissionSources, []);
});

test('school submission rejects a stale association after unlink/relink and cannot silently capture a new School ID', t => {
  const f = fixture(t), link = linked(f), job = f.store.job(f.owner, link.jobId);
  f.store.setApplicationChannel(f.owner, job.id, { channel: 'both' });
  const material = randomUUID();
  f.store.db.prepare('INSERT INTO materials VALUES (?,?,?,?,?,?)').run(material, f.owner, job.id, material, JSON.stringify({ context: f.store.materialContext(f.owner, job.id) }), f.store.now());
  const value = { channel: 'school', schoolRevision: link.revision, materialId: material, date: '2026-01-01', confirmed: true, attachmentsComplete: true, requestId: randomUUID() };
  f.store.changeSchool(f.owner, link.schoolId, maintenance(f, link, 'unlink'));
  assert.throws(() => f.store.recordSubmission(f.owner, job.id, value), { status: 409 });
  const replacement = linked(f, '900002', job);
  assert.throws(() => f.store.recordSubmission(f.owner, job.id, value), { status: 409 });
  assert.throws(() => f.store.recordSubmission(f.owner, job.id, { ...value, schoolRevision: undefined }), { status: 409 });
  assert.deepEqual(f.store.application(f.owner, job.id).submissions, []);
  f.store.recordSubmission(f.owner, job.id, { ...value, schoolRevision: replacement.revision });
  assert.equal(f.store.schoolSubmissionSources(f.owner)[0].schoolId, '900002');
});


test('first school channel correction checks current association and preserves employer history on conflict', t => {
  const f = fixture(t), link = linked(f), record = submission(f, link.jobId, 'employer');
  const before = f.store.application(f.owner, link.jobId);
  f.store.changeSchool(f.owner, link.schoolId, maintenance(f, link, 'update', { row: { ...link.row, location: 'Markham' } }));
  const value = { channel: 'school', date: record.date, receipt: '', reason: 'Correct channel', revision: 0, requestId: randomUUID(), schoolRevision: link.revision };
  assert.throws(() => f.store.correctSubmission(f.owner, link.jobId, record.id, value), { status: 409 });
  assert.deepEqual(f.store.application(f.owner, link.jobId), before);
  f.store.correctSubmission(f.owner, link.jobId, record.id, { ...value, schoolRevision: f.store.schoolContext(f.owner, link.jobId).revision });
  assert.equal(f.store.schoolSubmissionSources(f.owner)[0].schoolId, link.schoolId);
});
