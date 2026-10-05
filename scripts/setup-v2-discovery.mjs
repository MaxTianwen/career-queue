import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openclaw } from '../src/automation.mjs';
import { atomicJson } from '../src/discovery-runner.mjs';

// Explicit operator step only. Never modifies, pauses or enables the old schedule.
const root = fileURLToPath(new URL('../', import.meta.url));
try {
  const config = JSON.parse(await readFile(resolve(root, 'private/v2-local/discovery-trigger.json'), 'utf8'));
  if (!/^[a-f0-9]{64}$/.test(config.token)) throw Error('请先 prepare 独立后台凭证');
  const saved = resolve(root, 'private/v2-local/discovery-schedule.json');
  let existing;
  try { existing = JSON.parse(await readFile(saved, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing) { await openclaw(root, ['automations', 'get', existing.jobId]); console.log('已有v2日程，保留原暂停/启用状态。'); }
  else {
    const response = await openclaw(root, ['automations', 'create', '--cron', '* * * * *', '--tz', 'America/Toronto', '--exact',
      '--name', 'Career Queue v2 daily discovery', '--declaration-key', 'career-queue-v2-discovery',
      '--command-argv', JSON.stringify([process.execPath, resolve(root, 'scripts/v2-discovery.mjs'), 'tick']), '--command-cwd', root,
      '--timeout-seconds', '660', '--output-max-bytes', '4096', '--no-deliver', '--disabled']);
    const jobId = response.id || response.job?.id;
    if (!jobId) throw Error('未取得v2日程编号，未启用');
    await atomicJson(saved, { jobId }); console.log('v2日程已创建且暂停；旧日程未改。正式切换需另行确认。');
  }
} catch (error) { console.error(error.code === 'ENOENT' ? '独立后台凭证尚未准备。' : error.message); process.exitCode = 1; }
