import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { WorkspaceStore } from '../src/v2/store.mjs';
import { backupWorkspace, restoreWorkspace } from '../src/v2/backup.mjs';
import { previewMigration, importMigration } from '../src/v2/migration.mjs';
import { createHash } from 'node:crypto';

function fixture(t) {
  const directory = resolve('output/test-runs', `migration-${randomUUID()}`), path = resolve(directory, 'live.sqlite');
  const store = new WorkspaceStore(path); t.after(() => store.close());
  const owner = randomUUID(), other = randomUUID();
  for (const [id, name] of [[owner, 'owner'], [other, 'other']]) store.db.prepare('INSERT INTO users(id,username,salt,password_hash) VALUES (?,?,?,?)').run(id, name, 'test', 'test');
  const original = { company: 'Synthetic', title: 'Developer', jd: 'Original JD', notes: 'Original note', status: 'Queue' };
  const job = store.saveJob(owner, original), file = store.saveFile(owner, 'historical.pdf', Buffer.from('%PDF-Synthetic'));
  const input = { source: 'v1-notion', sourceKey: 'a'.repeat(24), jobId: job.id, original,
    documents: [{ fileId: file.id, sha256: file.sha256, version: 'resume-old', baseline: 'old-baseline' }] };
  return { store, path, directory, owner, other, input, job, file };
}
test('migration provenance is immutable, repeatable after job edits, and never creates review or submission state', t => {
  const f = fixture(t), receipt = f.store.recordMigration(f.owner, f.input);
  f.store.saveJob(f.owner, { ...f.input.original, title: 'New title' }, f.job.id);
  assert.deepEqual(f.store.recordMigration(f.owner, f.input), receipt);
  assert.throws(() => f.store.recordMigration(f.owner, { ...f.input, original: { ...f.input.original, notes: 'Changed' } }), { status: 409 });
  assert.equal(receipt.documents[0].classification, 'historical-generated-unreviewed');
  for (const table of ['materials', 'submissions', 'generated_resumes', 'active_resume']) assert.equal(f.store.db.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0);
  assert.equal(f.store.migrationReceipts(f.owner).length, 1);
});
test('migration receipt validates owner, file hashes, duplicate file references and hides other-account history', t => {
  const f = fixture(t); f.store.recordMigration(f.owner, f.input);
  assert.throws(() => f.store.recordMigration(f.other, f.input), { status: 404 });
  assert.deepEqual(f.store.migrationReceipts(f.other), []);
  const foreign = f.store.saveFile(f.other, 'other.pdf', Buffer.from('%PDF-Other'));
  assert.throws(() => f.store.recordMigration(f.owner, { ...f.input, sourceKey: 'b'.repeat(24), documents: [{ ...f.input.documents[0], fileId: foreign.id }] }), { status: 404 });
  assert.throws(() => f.store.recordMigration(f.owner, { ...f.input, documents: [{ ...f.input.documents[0], sha256: 'wrong' }] }), { status: 409 });
  assert.throws(() => f.store.recordMigration(f.owner, { ...f.input, documents: [...f.input.documents, ...f.input.documents] }), { status: 409 });
  assert.equal(f.store.migrationReceipts(f.owner).length, 1);
});
test('migration receipt survives personal export and independent full backup restore', async t => {
  const f = fixture(t), receipt = f.store.recordMigration(f.owner, f.input);
  assert.deepEqual(f.store.exportData(f.owner).migrationReceipts, [receipt]);
  assert.deepEqual(f.store.exportData(f.other).migrationReceipts, []);
  await backupWorkspace(f.path, resolve(f.directory, 'backup'));
  await restoreWorkspace(resolve(f.directory, 'backup'), resolve(f.directory, 'restored'));
  const restored = new WorkspaceStore(resolve(f.directory, 'restored/workspaces.sqlite')); t.after(() => restored.close());
  assert.deepEqual(restored.migrationReceipts(f.owner), [receipt]);
  assert.equal(restored.file(f.owner, f.file.id).sha256, f.file.sha256);
});

function bundle() {
  const bytes = Buffer.from('%PDF-Synthetic legacy file');
  return { record: { key: 'b'.repeat(24), company: 'Legacy Company', title: 'Legacy Intern', jd: 'Python required', status: 'Queue' },
    documents: [{ name: 'legacy.pdf', base64: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex'), version: 'legacy-v1' }] };
}
test('bounded migration preview is read-only, import is atomic and repeatable across restart', t => {
  const f = fixture(t), data = bundle(), ro = new WorkspaceStore(f.path, { readOnly: true });
  const preview = previewMigration(ro, f.owner, data); ro.close();
  assert.equal(f.store.jobs(f.owner).length, 1);
  const confirmed = { confirmed: true, fingerprint: preview.fingerprint };
  assert.throws(() => importMigration(f.store, f.owner, data, { ...confirmed, confirmed: false }), { status: 400 });
  const receipt = importMigration(f.store, f.owner, data, confirmed);
  assert.equal(f.store.jobs(f.owner).length, 2); assert.equal(f.store.files(f.owner).length, 2);
  assert.deepEqual(importMigration(f.store, f.owner, data, confirmed), receipt);
  const reopened = new WorkspaceStore(f.path); t.after(() => reopened.close());
  assert.deepEqual(importMigration(reopened, f.owner, data, confirmed), receipt);
  assert.equal(f.store.application(f.owner, receipt.jobId).submissions.length, 0);
  assert.equal(f.store.application(f.owner, receipt.jobId).versions.length, 0);
  assert.equal(f.store.activeResume(f.owner), null);
  assert.throws(() => importMigration(f.store, f.owner, { ...data, record: { ...data.record, jd: 'Changed' } }, confirmed), { status: 409 });
});
test('bounded migration refuses stale target, foreign confirmation, duplicate job and unsupported histories', t => {
  const f = fixture(t), data = bundle(), p = previewMigration(f.store, f.owner, data);
  assert.throws(() => importMigration(f.store, f.other, data, { confirmed: true, fingerprint: p.fingerprint }), { status: 409 });
  f.store.saveJob(f.owner, { company: 'Additional', title: 'Job' });
  assert.throws(() => importMigration(f.store, f.owner, data, { confirmed: true, fingerprint: p.fingerprint }), { status: 409 });
  for (const changed of [{ status: '已投递' }, { portal: { id: '123' } }, { portalHistory: [{}] }, { materials: { resume: 'old.pdf' } }, { applicationDate: '2026-01-01' }])
    assert.throws(() => previewMigration(f.store, f.owner, { ...data, record: { ...data.record, ...changed } }), { status: 409 });
  f.store.saveJob(f.owner, data.record);
  assert.throws(() => previewMigration(f.store, f.owner, data), { status: 409 });
});
test('bounded migration rolls back job and files when receipt persistence fails', t => {
  const f = fixture(t), data = bundle(), preview = previewMigration(f.store, f.owner, data);
  f.store.db.exec("CREATE TRIGGER migration_fail BEFORE INSERT ON migration_receipts BEGIN SELECT RAISE(ABORT, 'Synthetic failure'); END");
  assert.throws(() => importMigration(f.store, f.owner, data, { confirmed: true, fingerprint: preview.fingerprint }), /Synthetic failure/);
  assert.equal(f.store.jobs(f.owner).length, 1); assert.equal(f.store.files(f.owner).length, 1); assert.deepEqual(f.store.migrationReceipts(f.owner), []);
});
test('bounded migration rejects corrupt, duplicate and oversized material packages before writing', t => {
  const f = fixture(t), data = bundle();
  assert.throws(() => previewMigration(f.store, f.owner, { ...data, documents: [{ ...data.documents[0], sha256: 'wrong' }] }), { status: 409 });
  assert.throws(() => previewMigration(f.store, f.owner, { ...data, documents: [...data.documents, ...data.documents] }), { status: 400 });
  assert.throws(() => previewMigration(f.store, f.owner, { ...data, documents: [{ ...data.documents[0], name: '../legacy.pdf' }] }), { status: 400 });
  assert.throws(() => previewMigration(f.store, f.owner, { ...data, documents: [{ ...data.documents[0], base64: '?' }] }), { status: 400 });
  for (let i = 0; i < 19; i++) f.store.saveFile(f.owner, `quota-${i}.pdf`, Buffer.from('%PDF-Fixture'));
  assert.throws(() => previewMigration(f.store, f.owner, data), { status: 409 });
  assert.equal(f.store.jobs(f.owner).length, 1);
});
