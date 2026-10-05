import { DatabaseSync, backup } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile, copyFile, open, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { constants } from 'node:fs';

async function checksum(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
function validate(db) {
  if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('数据库完整性校验未通过');
  for (const name of ['users', 'jobs', 'files', 'resume_text', 'active_resume', 'materials', 'submissions', 'generated_resumes', 'settings', 'sessions', 'pdf_reviews']) {
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name)) throw new Error('不是当前 v2 工作区备份');
  }
  for (const file of db.prepare('SELECT size,sha256,bytes FROM files').iterate()) {
    if (file.size !== file.bytes.length || createHash('sha256').update(file.bytes).digest('hex') !== file.sha256) throw new Error('备份文件内容校验未通过');
  }
  return Object.fromEntries(['users', 'jobs', 'files', 'materials', 'submissions', 'generated_resumes'].map(name => [name, db.prepare(`SELECT count(*) n FROM ${name}`).get().n]));
}
async function syncFile(path) { const file = await open(path, 'r+'); try { await file.sync(); } finally { await file.close(); } }

// Operator-only utility. Not exposed through any HTTP route or administrator account.
export async function backupWorkspace(source, destination) {
  if (!(await stat(source)).isFile()) throw new Error('来源数据库不存在');
  await mkdir(destination); // Existing directories, including live workspaces, are refused.
  const target = resolve(destination, 'workspaces.sqlite');
  const live = new DatabaseSync(source, { readOnly: true });
  try { await backup(live, target); } finally { live.close(); }
  const snapshot = new DatabaseSync(target);
  let counts;
  try {
    counts = validate(snapshot);
    // Only the new snapshot is changed. Restored sessions and PDF approvals must never revive.
    snapshot.exec('PRAGMA journal_mode=DELETE; PRAGMA secure_delete=ON; BEGIN; DELETE FROM sessions; DELETE FROM pdf_reviews; DELETE FROM auth_attempts; COMMIT;');
    validate(snapshot);
  } finally { snapshot.close(); }
  await syncFile(target);
  const manifest = { format: 'career-queue-v2-backup', version: 1, createdAt: new Date().toISOString(), sha256: await checksum(target), counts,
    excludes: ['active sessions', 'PDF preview approvals', 'Word working directories', 'runtime configuration', 'v1 / Notion data'] };
  const manifestPath = resolve(destination, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
  await syncFile(manifestPath);
  return manifest;
}
export async function restoreWorkspace(source, destination) {
  const manifestPath = resolve(source, 'manifest.json');
  if ((await stat(manifestPath)).size > 16384) throw new Error('备份清单不正确');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')), from = resolve(source, 'workspaces.sqlite');
  if (manifest.format !== 'career-queue-v2-backup' || manifest.version !== 1 || !/^[a-f0-9]{64}$/.test(manifest.sha256) || await checksum(from) !== manifest.sha256) throw new Error('备份校验失败；未恢复任何记录');
  await mkdir(destination); // Never replace or merge into an existing directory.
  const target = resolve(destination, 'workspaces.sqlite');
  await copyFile(from, target, constants.COPYFILE_EXCL);
  if (await checksum(target) !== manifest.sha256) throw new Error('复制期间备份发生变化，停止恢复');
  const restored = new DatabaseSync(target);
  let counts;
  try {
    counts = validate(restored);
    if (JSON.stringify(counts) !== JSON.stringify(manifest.counts)) throw new Error('备份记录数量不一致');
    restored.exec('PRAGMA secure_delete=ON; BEGIN; DELETE FROM sessions; DELETE FROM pdf_reviews; DELETE FROM auth_attempts; COMMIT;');
  } finally { restored.close(); }
  await syncFile(target);
  await writeFile(resolve(destination, 'restore-verified.json'), JSON.stringify({ restoredAt: new Date().toISOString(), sourceSha256: manifest.sha256, sha256: await checksum(target), counts }, null, 2), { flag: 'wx', mode: 0o600 });
  return counts;
}
