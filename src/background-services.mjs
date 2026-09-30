import { connect } from 'node:net';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

export const workspaceId = root => createHash('sha256').update(resolve(root).toLowerCase()).digest('hex');
export function portListening(port) {
  return new Promise(resolve => {
    const socket = connect({ host: '127.0.0.1', port });
    const done = value => { socket.destroy(); resolve(value); };
    socket.setTimeout(1000);
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
  });
}
export async function dashboardReady(root, port = 4317) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, { redirect: 'error', signal: AbortSignal.timeout(2000) });
    if (!response.ok) return false;
    const info = await response.json();
    return info.service === 'career-queue' && info.workspaceId === workspaceId(root) && info.ready === true;
  } catch { return false; }
}

// Only children created here are owned. An occupied port is never a reason to
// kill a process, and an in-flight check cannot start another copy.
export function serviceMonitor({ services, save, clock = () => Date.now(), listening = portListening }) {
  const children = new Map(), states = {};
  let pending;
  async function inspect() {
    for (const service of services) {
      const child = children.get(service.name);
      const occupied = await listening(service.port);
      if (occupied && await service.ready().catch(() => false)) {
        states[service.name] = { state: 'ready', checkedAt: clock() };
      } else if (child) {
        states[service.name] = { state: clock() - child.startedAt < 90000 ? 'starting' : 'unavailable', checkedAt: clock() };
      } else if (occupied) {
        states[service.name] = { state: 'unavailable', checkedAt: clock(), reason: 'port-unverified' };
      } else {
        try {
          const process = service.launch();
          children.set(service.name, { process, startedAt: clock() });
          states[service.name] = { state: 'starting', checkedAt: clock() };
          const retired = () => {
            if (children.get(service.name)?.process !== process) return;
            children.delete(service.name);
            states[service.name] = { state: 'unavailable', checkedAt: clock(), reason: 'process-exited' };
          };
          process.once('exit', retired); process.once('error', retired);
        } catch {
          states[service.name] = { state: 'unavailable', checkedAt: clock(), reason: 'launch-failed' };
        }
      }
    }
    await save({ checkedAt: clock(), services: states });
    return states;
  }
  return { check() {
    if (!pending) pending = inspect().finally(() => { pending = null; });
    return pending;
  } };
}
