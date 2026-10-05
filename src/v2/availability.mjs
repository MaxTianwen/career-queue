import { randomUUID } from 'node:crypto';
import { checkAvailability } from '../availability.mjs';
import { deadlineExpired, extractDeadline } from '../deadlines.mjs';
import { digest } from './resume.mjs';
import { fail } from './store.mjs';

// Short-lived checks belong to one session and exact saved inputs; restart requires rechecking.
export function availabilityGate(store, check = checkAvailability) {
  const checks = new Map(), busy = new Set(), ttl = 15 * 60000;
  function inputs(owner, id) {
    const context = store.materialContext(owner, id), school = store.schoolLinks(owner).find(link => link.jobId === id) ?? null;
    return { context, school, hash: digest(JSON.stringify({ context: context.hash, school })) };
  }
  const key = (owner, id, session) => `${owner}:${id}:${session}`;
  return {
    async refresh(owner, id, session) {
      const input = inputs(owner, id), k = key(owner, id, session), started = store.now();
      for (const [name, row] of checks) if (started - row.time > ttl) checks.delete(name);
      if (busy.has(k)) fail(409, '正在核查此岗位，请稍候');
      if (checks.size >= 500 && !checks.has(k)) fail(429, '核查请求过多，请稍后重试');
      checks.delete(k); busy.add(k);
      try {
        const job = input.context.job;
        let result;
        if (deadlineExpired(extractDeadline(job).deadline, new Date(started))) result = { status: 'closed', evidence: 'JD 中的明确申请截止时间已过' };
        else if (!job.url && deadlineExpired(input.school?.row.deadline, new Date(started))) result = { status: 'closed', evidence: '学校申请截止时间已过' };
        else if (!job.url) result = { status: 'unknown', evidence: '没有官网链接，请在学校或实际申请入口核实仍接受申请' };
        else {
          try { result = await check(job, { now: new Date(started) }); }
          catch { result = { status: 'unknown', evidence: '官方来源暂时无法读取，请本人核实' }; }
        }
        if (inputs(owner, id).hash !== input.hash) fail(409, '岗位、简历或学校来源已变化，请重新核查');
        const value = { id: randomUUID(), status: ['open', 'closed', 'unknown'].includes(result.status) ? result.status : 'unknown',
          evidence: String(result.evidence || '请本人核实').slice(0, 500), checkedAt: new Date(started).toISOString() };
        checks.set(k, { ...value, time: started, hash: input.hash });
        return value;
      } finally { busy.delete(k); }
    },
    require(owner, id, session, value) {
      const row = checks.get(key(owner, id, session)), age = row ? store.now() - row.time : Infinity;
      if (!row || row.id !== value.availability?.id || age < 0 || age > ttl || row.hash !== inputs(owner, id).hash)
        fail(409, '开放核查已失效，请重新核查并确认；修改内容可保留');
      if (row.status === 'closed') fail(409, `岗位已关闭，不能准备材料：${row.evidence}`);
      if (value.openConfirmed !== true) fail(409, '请核对开放结果；无法自动确认时需本人到申请入口核实');
    }
  };
}
