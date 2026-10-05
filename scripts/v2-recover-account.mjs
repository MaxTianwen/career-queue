import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recoverAccount } from '../src/v2/account-recovery.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const [username, confirm, ...extra] = process.argv.slice(2);
try {
  if (!username || confirm !== '--confirm-reset' || extra.length) throw new Error('用法：npm run recover:v2 -- <账号> --confirm-reset（使该账号旧密码和会话失效）');
  const path = await recoverAccount({ database: resolve(root, 'private/v2-local/workspaces.sqlite'), directory: resolve(root, 'private/v2-local/recovery'), username });
  console.log(`指定账号密码已重置，资料与权限保持。新登录信息只保存在：${path}`);
} catch (error) { console.error(error.status ? error.message : error.code ? '本机恢复未完成，请检查数据库与目录权限；不会输出密码。' : error.message); process.exitCode = 1; }
