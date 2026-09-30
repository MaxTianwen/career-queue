import { createServer, connect } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdirSync, openSync, closeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openclawArgs, openclawEnv } from '../src/automation.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lock = createServer(socket => socket.destroy());
lock.on('error', error => { if (error.code !== 'EADDRINUSE') console.error(error.message); process.exit(error.code === 'EADDRINUSE' ? 0 : 1); });
const listening = port => new Promise(resolve => {
  const socket = connect({ host: '127.0.0.1', port });
  socket.setTimeout(1000);
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('error', () => resolve(false));
  socket.once('timeout', () => { socket.destroy(); resolve(false); });
});
const children = new Map();
async function maintain() {
  for (const [name, port, argv, env] of [
    ['dashboard', 4317, [resolve(root, 'src/dashboard.mjs')], process.env],
    ['gateway', 18791, openclawArgs(root, ['gateway', 'run']), openclawEnv(root)]
  ]) {
    if (children.has(name) || await listening(port)) continue;
    const log = openSync(resolve(root, `output/automation/${name}.log`), 'a');
    const child = spawn(process.execPath, argv, { cwd: name === 'gateway' ? resolve(root, 'private') : root, env, windowsHide: true, stdio: ['ignore', log, log] });
    closeSync(log);
    children.set(name, child);
    child.once('exit', () => children.delete(name)); child.once('error', () => children.delete(name));
  }
}
lock.listen(4318, '127.0.0.1', () => {
  mkdirSync(resolve(root, 'output/automation'), { recursive: true });
  void maintain(); setInterval(() => void maintain(), 30000);
});
