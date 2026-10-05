import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { backupWorkspace, restoreWorkspace } from '../src/v2/backup.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const [command, source, ...extra] = process.argv.slice(2);
try {
  if (extra.length || !['create', 'restore'].includes(command) || (command === 'create' && source) || (command === 'restore' && !source)) throw new Error('用法：npm run backup:v2；恢复验证：npm run restore:v2 -- <备份目录>');
  const parent = resolve(root, command === 'create' ? 'private/v2-backups' : 'private/v2-restores');
  await mkdir(parent, { recursive: true });
  const destination = resolve(parent, `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`);
  if (command === 'create') await backupWorkspace(resolve(root, 'private/v2-local/workspaces.sqlite'), destination);
  else await restoreWorkspace(resolve(source), destination);
  console.log(`${command === 'create' ? '备份完成' : '已恢复到独立目录，尚未替换运行数据'}：${destination}`);
  console.log('含私人记录和账号密码哈希，请妥善保存，不要上传 GitHub。没有删除或覆盖原目录。');
} catch (error) { console.error(`操作未完成：${error.message}。残留目录保留，不自动删除。`); process.exitCode = 1; }
