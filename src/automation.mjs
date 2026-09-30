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
export async function openclaw(root, args) {
  const { stdout } = await exec(process.execPath, openclawArgs(root, [...args, '--json']),
    { cwd: resolve(root, 'private'), env: openclawEnv(root), windowsHide: true, timeout: 45000, maxBuffer: 1024 * 1024 });
  const start = stdout.indexOf('{');
  if (start < 0) throw new Error('OpenClaw 未返回有效状态');
  return JSON.parse(stdout.slice(start));
}
export function automationAdapter(root) {
  let cached = null, expires = 0;
  async function setting() { return JSON.parse(await readFile(resolve(root, 'private/automation.json'), 'utf8')); }
  return {
    async status(force = false) {
      if (!force && cached && Date.now() < expires) return cached;
      try {
        const config = await setting();
        const response = await openclaw(root, ['automations', 'get', config.jobId]);
        const job = response.job || response;
        if (job.id !== config.jobId) throw new Error('日程记录不匹配');
        cached = { configured: true, connected: true, enabled: job.enabled === true, jobId: job.id,
          gatewayNextCheck: job.state?.nextRunAtMs ? new Date(job.state.nextRunAtMs).toISOString() : null };
      } catch (e) {
        cached = { configured: e.code !== 'ENOENT', connected: false, enabled: false,
          error: e.code === 'ENOENT' ? '尚未安装日程' : '无法连接 OpenClaw，请检查后台运行状态' };
      }
      expires = Date.now() + 15000; return cached;
    },
    async setEnabled(enabled) {
      const config = await setting();
      await openclaw(root, ['automations', enabled ? 'enable' : 'disable', config.jobId]);
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
