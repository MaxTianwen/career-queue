import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url)), directory = resolve(root, 'private/v2-local');
const config = resolve(directory, 'discovery-trigger.json');
try {
  const [command, ...extra] = process.argv.slice(2);
  if (extra.length || !['prepare', 'tick'].includes(command)) throw Error('使用 prepare 准备独立本机凭证，或 tick 调用已运行的 v2 服务');
  if (command === 'prepare') {
    await mkdir(directory, { recursive: true });
    await writeFile(config, JSON.stringify({ token: randomBytes(32).toString('hex') }), { flag: 'wx', mode: 0o600 });
    console.log('独立凭证已准备；重启 v2 后生效。未创建或启用日程，未修改旧版。');
  } else {
    const { token } = JSON.parse(await readFile(config, 'utf8'));
    if (!/^[a-f0-9]{64}$/.test(token)) throw Error('后台入口配置无效');
    const base = 'http://127.0.0.1:4322';
    const response = await fetch(base + '/api/discovery/tick', { method: 'POST',
      headers: { Origin: base, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(650000) });
    const data = await response.json();
    if (response.status === 409) console.log('已有刷新正在执行，本次不另开搜索');
    else { if (!response.ok) throw Error(data.error || '后台调用失败'); console.log(JSON.stringify(data)); }
  }
} catch (error) { console.error(error.code === 'EEXIST' ? '已有独立凭证，保留原配置。' : error.code === 'ENOENT' ? '尚未准备独立后台凭证。' : error.message); process.exitCode = 1; }
