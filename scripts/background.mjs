import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdirSync, openSync, closeSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dashboardReady, serviceMonitor, workspaceId } from '../src/background-services.mjs';
import { atomicJson } from '../src/discovery-runner.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lock = createServer(socket => socket.destroy());
lock.on('error', error => { if (error.code !== 'EADDRINUSE') console.error(error.message); process.exit(error.code === 'EADDRINUSE' ? 0 : 1); });
const services = [
    ...(existsSync(resolve(root, 'private/v2-local/discovery-trigger.json')) ? [['workspace', 4322, [resolve(root, 'src/v2/server.mjs')], process.env]] : []),
    ['dashboard', 4317, [resolve(root, 'src/dashboard.mjs')], process.env]
  ].map(([name, port, argv, env]) => ({ name, port,
    ready: name === 'workspace' ? async () => {
      const response = await fetch('http://127.0.0.1:4322/api/health', {redirect:'error',signal:AbortSignal.timeout(2000)});
      const data = await response.json();
      return response.ok && data.app === 'career-queue-v2-local' && data.workspaceId === workspaceId(root) && data.ready === true;
    } : () => dashboardReady(root, port),
    launch() {
      const log = openSync(resolve(root, `output/automation/${name}.log`), 'a');
      try {
        return spawn(process.execPath, argv, { cwd: root, env, windowsHide: true, stdio: ['ignore', log, log] });
      } finally { closeSync(log); }
    }
  }));
const monitor = serviceMonitor({ services, save: state => atomicJson(resolve(root, 'output/automation/background.json'), state) });
const maintain = () => monitor.check().catch(() => console.error('后台状态检查失败，将在下一轮重试'));
lock.listen(4318, '127.0.0.1', () => {
  mkdirSync(resolve(root, 'output/automation'), { recursive: true });
  void maintain(); setInterval(() => void maintain(), 30000);
});
