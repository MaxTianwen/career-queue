import { open, mkdir, stat, unlink } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { WorkspaceStore } from './store.mjs';

// Requires local filesystem access. Passwords never pass through CLI arguments or stdout.
export async function recoverAccount({ database, directory, username }) {
  if (!(await stat(database)).isFile()) throw new Error('工作区数据库不存在');
  const store = new WorkspaceStore(database);
  let file, credentialPath, completed = false, ownsFile = false;
  try {
    if (typeof username !== 'string' || !/^[a-z0-9][a-z0-9_.-]{2,39}$/i.test(username)) throw new Error('请指定有效账号');
    username = username.toLowerCase();
    if (!store.db.prepare('SELECT id FROM users WHERE username=?').get(username)) throw new Error('账号不存在，未创建新账号');
    await mkdir(directory, { recursive: true });
    credentialPath = resolve(directory, `recovery-${username}-${randomUUID()}.txt`);
    file = await open(credentialPath, 'wx', 0o600);
    ownsFile = true;
    const password = randomBytes(24).toString('base64url');
    await file.writeFile(`Career Queue v2 本机账号恢复\n账号：${username}\n密码：${password}\n\n操作完成后此密码生效，旧会话失效。登录后可在账号设置修改。\n请妥善保管本文件；不要上传 GitHub 或分享。旧 admin-login.txt 不再代表当前密码。\n`);
    await file.sync(); await file.close(); file = null;
    await store.resetPassword({ username, password }); completed = true;
    return credentialPath;
  } finally {
    if (file) await file.close();
    // Remove only the single file created by this failed operation, never a directory.
    if (ownsFile && !completed) await unlink(credentialPath).catch(() => {});
    store.close();
  }
}
