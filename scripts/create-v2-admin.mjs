import { open, mkdir, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { WorkspaceStore } from '../src/v2/store.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = resolve(root, 'private/v2-local');
await mkdir(directory, { recursive: true });
const credentialPath = resolve(directory, 'admin-login.txt');
// Exclusive creation prevents a rerun from replacing credentials.
let file, store, created = false, ownsFile = false;
try {
  file = await open(credentialPath, 'wx', 0o600);
  ownsFile = true;
  const password = randomBytes(24).toString('base64url');
  await file.writeFile(`Career Queue v2 本机管理员\n登录地址：http://127.0.0.1:4322/\n账号：admin\n密码：${password}\n\n仅保存在本机 private 目录，请勿上传到 GitHub 或分享此文件。\n`);
  await file.close(); file = null;
  store = new WorkspaceStore(resolve(directory, 'workspaces.sqlite'));
  await store.createAdmin({ username: 'admin', password }); created = true;
  console.log('管理员 admin 已创建。登录信息：private/v2-local/admin-login.txt（不在终端输出密码）');
} catch (error) {
  if (file) await file.close();
  // Only this one exclusively created credential file is removed on failed provisioning.
  if (ownsFile && !created) await unlink(credentialPath).catch(() => {});
  console.error(error.code === 'EEXIST' ? '登录信息文件已存在，本次未创建或修改账号。' : error.status ? error.message : '创建失败，未覆盖已有账号。');
  process.exitCode = 1;
} finally { store?.close(); }
