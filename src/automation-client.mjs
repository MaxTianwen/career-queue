import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function runDiscoveryCommand(command = 'tick', base = 'http://127.0.0.1:4317') {
  if (!['tick', 'discover', 'status'].includes(command)) throw new Error('支持 tick / discover / status');
  const get = async path => {
    const r = await fetch(base + path, { signal: AbortSignal.timeout(60000) });
    const data = await r.json(); if (!r.ok) throw new Error(data.error); return data;
  };
  if (command === 'status') return get('/api/automation');
  const { csrf } = await get('/api/status');
  const r = await fetch(base + (command === 'tick' ? '/api/automation/tick' : '/api/discovery'), {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: '{}', signal: AbortSignal.timeout(60000)
  });
  const started = await r.json();
  // A busy tick has not started a search. Let the existing schedule check again;
  // do not retry mutations or disguise other conflicts and failures as success.
  if (command === 'tick' && r.status === 409 && started.code === 'OPERATION_BUSY') {
    return { deferred: true, reason: 'operation-busy', message: '本次检查暂缓；未开始搜索，等待下一次定时检查' };
  }
  if (!r.ok) throw new Error(started.error);
  if (started.cached || started.skipped || started.waiting) return started;
  const id = started.runId;
  if (!id) return started;
  for (let n = 0; n < 600; n++) {
    const info = await get('/api/automation');
    const run = info.runs.find(run => run.id === id);
    if (run && run.status !== 'running') {
      if (['failed', 'interrupted'].includes(run.status)) throw new Error(`搜索未完成：${run.id}；详情见 Dashboard`);
      return { runId: run.id, status: run.status, count: run.count, dashboard: `${base}/#discover` };
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('等待搜索超时，请在 Dashboard 查看进度；不会另开一轮');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runDiscoveryCommand(process.argv[2]).then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
