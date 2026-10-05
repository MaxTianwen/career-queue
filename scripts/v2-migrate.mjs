import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { WorkspaceStore } from '../src/v2/store.mjs';
import { previewMigration, importMigration } from '../src/v2/migration.mjs';

// Explicit paths and account; no default target and no Notion or network writes.
const [command, database, bundlePath, username, fingerprint, ...extra] = process.argv.slice(2);
let store;
try {
  if (!['preview', 'apply'].includes(command) || !database || !bundlePath || !username || extra.length ||
      (command === 'preview' && fingerprint) || (command === 'apply' && !/^[a-f0-9]{64}$/.test(fingerprint ?? '')))
    throw new Error('用法：node scripts/v2-migrate.mjs preview <数据库> <迁入包JSON> <账号>；核对及备份后使用 apply，并追加预览 fingerprint');
  if (!(await stat(resolve(database))).isFile()) throw new Error('目标数据库不存在');
  if ((await stat(resolve(bundlePath))).size > 30 * 1024 * 1024) throw new Error('迁入包超过 30MB');
  const bundle = JSON.parse(await readFile(resolve(bundlePath), 'utf8'));
  store = new WorkspaceStore(resolve(database), { readOnly: command === 'preview' });
  const account = store.db.prepare('SELECT id FROM users WHERE username=?').get(username);
  if (!account) throw new Error('目标账号不存在');
  if (command === 'preview') console.log(JSON.stringify(previewMigration(store, account.id, bundle), null, 2));
  else {
    const receipt = importMigration(store, account.id, bundle, { confirmed: true, fingerprint });
    console.log(JSON.stringify({ receiptId: receipt.id, sourceKey: receipt.sourceKey, jobId: receipt.jobId, files: receipt.documents.length }));
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { store?.close(); }
