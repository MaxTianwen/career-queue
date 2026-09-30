import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const exec = promisify(execFile);
export function openclawArgs(root, args = []) {
  return ['--require', resolve(root, 'scripts/hide-background-windows.cjs'),
    resolve(root, 'private/openclaw-runtime/node_modules/openclaw/openclaw.mjs'), ...args];
}
export function openclawEnv(root) {
  // Keep this Gateway separate from any personal OpenClaw account and providers.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(path|pathext|systemroot|windir|temp|tmp|userprofile|appdata|localappdata|comspec|processor_architecture)$/i.test(key)));
  return { ...env, OPENCLAW_STATE_DIR: resolve(root, 'private/openclaw-state'), OPENCLAW_CONFIG_PATH: resolve(root, 'private/openclaw-state/openclaw.json') };
}
export async function openclaw(root, args, { timeout = 45000 } = {}) {
  const { stdout } = await exec(process.execPath, openclawArgs(root, [...args, '--json']),
    { cwd: resolve(root, 'private'), env: openclawEnv(root), windowsHide: true, timeout, maxBuffer: 1024 * 1024 });
  const start = stdout.indexOf('{');
  if (start < 0) throw new Error('OpenClaw 未返回有效状态');
  return JSON.parse(stdout.slice(start));
}
export function automationAdapter(root, { call = openclaw, clock = () => Date.now() } = {}) {
  let cached = null, expires = 0, pending = null;
  async function setting() { return JSON.parse(await readFile(resolve(root, 'private/automation.json'), 'utf8')); }
  return {
    async status(force = false) {
      if (pending) { await pending; if (!force) return cached; }
      if (!force && cached && clock() < expires) return cached;
      pending = (async () => {
        try {
          const config = await setting();
          const response = await call(root, ['automations', 'get', config.jobId], { timeout: 10000 });
          const job = response.job || response;
          if (job.id !== config.jobId) throw new Error('日程记录不匹配');
          if (typeof job.enabled !== 'boolean') throw new Error('日程开关未确认');
          cached = { configured: true, connected: true, enabled: job.enabled, state: job.enabled ? 'enabled' : 'paused', checkedAt: clock(), jobId: job.id,
            gatewayNextCheck: job.state?.nextRunAtMs ? new Date(job.state.nextRunAtMs).toISOString() : null };
        } catch (e) {
          const background = await readFile(resolve(root, 'output/automation/background.json'), 'utf8').then(JSON.parse).catch(() => null);
          const starting = clock() - background?.checkedAt >= 0 && clock() - background?.checkedAt < 90000 && background?.services?.gateway?.state === 'starting';
          cached = { configured: e.code !== 'ENOENT', connected: false, enabled: null,
            state: e.code === 'ENOENT' ? 'unconfigured' : starting ? 'starting' : 'unavailable', checkedAt: clock(),
            error: e.code === 'ENOENT' ? '尚未安装日程' : starting ? '后台正在启动，请稍后刷新' : '后台连接待核实，不能确认日程是否启用' };
        }
        expires = clock() + 15000;
      })();
      try { await pending; return cached; } finally { pending = null; }
    },
    async setEnabled(enabled) {
      const config = await setting();
      await call(root, ['automations', enabled ? 'enable' : 'disable', config.jobId]);
      const result = await this.status(true);
      if (!result.connected || result.enabled !== enabled) throw new Error('无法确认日程设置，请刷新后检查');
      return result;
    }
  };
}

export async function networkAvailable() {
  // Either independent public source responding proves connectivity; HTTP errors are
  // source failures, not evidence that the computer is offline.
  const checks = ['https://raw.githubusercontent.com', 'https://boards-api.greenhouse.io'].map(async url => {
    const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
    await response.body?.cancel(); return true;
  });
  try { return await Promise.any(checks); } catch { return false; }
}
