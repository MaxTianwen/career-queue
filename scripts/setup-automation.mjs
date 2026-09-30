import { readFile, mkdir, access } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openclaw, openclawArgs, openclawEnv } from '../src/automation.mjs';
import { atomicJson } from '../src/discovery-runner.mjs';
import { portListening } from '../src/background-services.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configFile = resolve(root, 'private/openclaw-state/openclaw.json');
await access(resolve(root, 'private/openclaw-runtime/node_modules/openclaw/openclaw.mjs'));
await mkdir(dirname(configFile), { recursive: true });
try { await access(configFile); } catch {
  await atomicJson(configFile, { gateway: { mode: 'local', bind: 'loopback', port: 18791, auth: { mode: 'token', token: randomBytes(32).toString('hex') }, controlUi: { enabled: false } },
    agents: { defaults: { workspace: resolve(root, 'private/openclaw-workspace'), heartbeat: { every: '0m' } } },
    skills: { workshop: { autonomous: { mode: 'off' } } },
    plugins: { enabled: false }, cron: { skipMissedJobs: true, failureAlert: { enabled: false } } });
}
try { await openclaw(root, ['automations', 'list']); } catch {
  const config = JSON.parse(await readFile(configFile, 'utf8'));
  if (await portListening(config.gateway?.port || 18791)) throw new Error('Gateway 端口已被占用，但未通过连接核实。请等待已有后台启动；未启动第二份进程、未修改日程。');
  const gateway = spawn(process.execPath, openclawArgs(root, ['gateway', 'run']),
    { cwd: resolve(root, 'private'), env: openclawEnv(root), windowsHide: true, detached: true, stdio: 'ignore' });
  gateway.unref();
  let ready = false;
  for (let n = 0; n < 12; n++) {
    await new Promise(r => setTimeout(r, 2000));
    try { await openclaw(root, ['automations', 'list']); ready = true; break; } catch {}
  }
  if (!ready) throw new Error('Gateway 未就绪，未启用日程');
}
const existing = await readFile(resolve(root, 'private/automation.json'), 'utf8').then(JSON.parse).catch(e => { if (e.code !== 'ENOENT') throw e; return null; });
if (existing) {
  await openclaw(root, ['automations', 'get', existing.jobId]);
  console.log('已有日程，保留现有暂停 / 启用状态。');
} else {
  const job = await openclaw(root, ['automations', 'create', '--cron', '* * * * *', '--tz', 'America/Toronto', '--exact',
    '--name', 'Career Queue daily discovery', '--declaration-key', 'career-queue-v130-discovery',
    '--command-argv', JSON.stringify([process.execPath, resolve(root, 'src/automation-client.mjs'), 'tick']), '--command-cwd', root,
    '--timeout-seconds', '660', '--output-max-bytes', '4096', '--no-deliver', '--disabled']);
  const id = job.id || job.job?.id;
  if (!id) throw new Error('未取得日程编号，未启用');
  await atomicJson(resolve(root, 'private/automation.json'), { jobId: id, version: '2026.9.6' });
  console.log('日程已创建，当前暂停；在 Dashboard 点击恢复自动运行后启用。');
}
if (process.argv.includes('--startup')) {
  await promisify(execFile)('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-File', resolve(root, 'scripts/start-background.ps1'), '-Install'], { windowsHide: true });
  console.log('已安装当前用户登录时的隐藏后台入口；未登录时不运行。');
}
