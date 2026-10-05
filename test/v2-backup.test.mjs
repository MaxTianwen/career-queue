import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { WorkspaceStore } from '../src/v2/store.mjs';
import { backupWorkspace, restoreWorkspace } from '../src/v2/backup.mjs';

const password = 'Synthetic backup password 2026!';
async function fixture(t) {
  const folder = resolve('output/test-runs', `v2-backup-${randomUUID()}`), source = resolve(folder, 'live/workspaces.sqlite');
  const store = new WorkspaceStore(source); t.after(() => store.close());
  await store.createAdmin({ username: 'admin', password });
  const a = await store.authenticate({ username: 'admin', password }), b = await store.authenticate({ username: 'member', password }, true);
  const owner = a.user.id, file = store.saveFile(owner, 'same-name.pdf', Buffer.from('%PDF-1.7 synthetic'));
  const parsed = store.saveParsed(owner, file.id, { text: 'Synthetic applicant with Python, SQL and data analysis project experience.', pages: 1, parser: 'fixture' });
  store.activateResume(owner, { ...parsed, confirmed: true });
  const job = store.saveJob(owner, { company: 'Synthetic Company', title: 'Intern', jd: 'Python SQL required', notes: 'Keep my note' });
  store.setApplicationChannel(owner, job.id, { channel: 'both' });
  store.markPdfViewed(owner, file.id, 1, a.csrf);
  const app = store.reviewMaterial(owner, job.id, { contextHash: store.materialContext(owner, job.id).hash, resumeFileId: file.id, confirmed: true }, a.csrf);
  store.recordSubmission(owner, job.id, { channel: 'employer', materialId: app.versions[0].id, date: '2026-01-01', confirmed: true, attachmentsComplete: true, receipt: 'Fixture receipt' });
  store.preferences(owner, { direction: 'data', locations: 'Toronto', jobTypes: 'intern' });
  store.setRegistration(owner, false);
  store.saveJob(b.user.id, { company: 'Other Company', title: 'Other Job' });
  return { store, folder, source, owner, a, b, job, file };
}
test('v2 live WAL backup restores independent data, bytes and history without reviving sessions', async t => {
  const f = await fixture(t), backupPath = resolve(f.folder, 'backup'), restoredPath = resolve(f.folder, 'restored');
  const before = f.store.application(f.owner, f.job.id);
  const manifest = await backupWorkspace(f.source, backupPath);
  assert.equal(manifest.counts.users, 2); assert.equal(manifest.counts.submissions, 1);
  assert.ok(f.store.session(f.a.token)); // The live database is never scrubbed.
  f.store.saveJob(f.owner, { ...f.job, notes: 'Changed after backup' }, f.job.id);
  await restoreWorkspace(backupPath, restoredPath);
  const restored = new WorkspaceStore(resolve(restoredPath, 'workspaces.sqlite')); t.after(() => restored.close());
  assert.equal(restored.session(f.a.token), null); assert.equal(restored.db.prepare('SELECT count(*) n FROM pdf_reviews').get().n, 0);
  assert.equal(restored.registrationOpen(), false);
  assert.equal((await restored.authenticate({ username: 'admin', password })).user.role, 'admin');
  assert.equal(restored.job(f.owner, f.job.id).notes, 'Keep my note');
  assert.equal(f.store.job(f.owner, f.job.id).notes, 'Changed after backup');
  assert.deepEqual(Buffer.from(restored.file(f.owner, f.file.id).bytes), Buffer.from('%PDF-1.7 synthetic'));
  assert.deepEqual(restored.application(f.owner, f.job.id), before);
  assert.throws(() => restored.file(f.b.user.id, f.file.id), { status: 404 });
  assert.equal(restored.activeResume(f.owner).fileId, f.file.id);
});
test('v2 backup and restore refuse existing destinations and incomplete or changed backups', async t => {
  const f = await fixture(t), dest = resolve(f.folder, 'backup');
  await backupWorkspace(f.source, dest);
  await assert.rejects(backupWorkspace(f.source, dest), { code: 'EEXIST' });
  const original = await readFile(f.source);
  await assert.rejects(restoreWorkspace(dest, resolve(f.folder, 'live')), { code: 'EEXIST' });
  assert.deepEqual(await readFile(f.source), original);
  await writeFile(resolve(dest, 'workspaces.sqlite'), Buffer.from('damaged'), { flag: 'a' });
  await assert.rejects(restoreWorkspace(dest, resolve(f.folder, 'bad-restore')), /校验失败/);
  const incomplete = resolve(f.folder, 'incomplete'); await mkdir(incomplete);
  await assert.rejects(restoreWorkspace(incomplete, resolve(f.folder, 'incomplete-restore')), { code: 'ENOENT' });
});
test('v2 backup rejects a file blob whose recorded digest is corrupt', async t => {
  const f = await fixture(t);
  f.store.db.prepare("UPDATE files SET sha256='invalid' WHERE id=?").run(f.file.id);
  await assert.rejects(backupWorkspace(f.source, resolve(f.folder, 'bad-backup')), /文件内容校验/);
  await assert.rejects(readFile(resolve(f.folder, 'bad-backup/manifest.json')), { code: 'ENOENT' });
});
