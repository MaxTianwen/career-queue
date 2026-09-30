import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { TARGET_TERMS } from './core.mjs';
import { jobInputHash } from './assessment.mjs';
import { mergeDiscoveryJobs } from './discovery-records.mjs';

export const TIME_ZONE = 'America/Toronto';
export function torontoDay(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
export function scheduledAt(day) {
  // 09:00 is outside the DST transition hours; calculate the offset on that date.
  const noon = new Date(`${day}T12:00:00Z`);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', hourCycle: 'h23' }).format(noon));
  return new Date(`${day}T${String(21 - hour).padStart(2, '0')}:00:00Z`).toISOString();
}
export async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), { flag: 'wx' });
  // Windows antivirus/indexers may briefly hold the destination after a read.
  for (let attempt = 0; ; attempt++) {
    try { await rename(temp, path); break; }
    catch (e) { if (!['EPERM', 'EACCES', 'EBUSY'].includes(e.code) || attempt >= 4) throw e; await new Promise(r => setTimeout(r, 50 * (attempt + 1))); }
  }
}

export class DiscoveryRunner {
  constructor({ root, discover, clock = () => new Date(), online = async () => true, save = atomicJson }) {
    Object.assign(this, { discover, clock, online, save });
    this.file = resolve(root, 'output/discovery/latest.json');
    this.stateFile = resolve(root, 'output/discovery/runs.json');
    this.search = { state: 'idle', phase: '', report: null, error: null };
    this.state = { runs: [], lastSuccessDay: null, waiting: null, retryAt: null };
    this.ready = this.load();
    this.pending = null;
  }
  async load() {
    try {
      const report = JSON.parse(await readFile(this.file, 'utf8'));
      if (report.finishedAt && Array.isArray(report.results)) {
        const merged = mergeDiscoveryJobs(report.results);
        report.results = merged.results; report.duplicates = (report.duplicates || 0) + merged.duplicates;
        this.search = { state: 'done', phase: '上次搜索结果', report, error: null };
      }
    } catch (e) { if (e.code !== 'ENOENT') this.search.error = '上次搜索快照无法读取，请重新搜索'; }
    try {
      const saved = JSON.parse(await readFile(this.stateFile, 'utf8'));
      if (!Array.isArray(saved.runs)) throw new Error('Invalid run history');
      this.state = saved;
      for (const run of this.state.runs) if (run.status === 'running') {
        // The result is committed first. Reconcile a crash between the two writes.
        if (this.search.report?.runId === run.id) {
          run.status = this.search.report.partial ? 'partial' : 'done';
          run.finishedAt = this.search.report.finishedAt; this.state.lastSuccessDay = run.day;
        } else { run.status = 'interrupted'; run.error = '服务退出时搜索尚未完成'; run.finishedAt = this.clock().toISOString(); }
      }
      await this.persist();
    } catch (e) {
      if (e.code !== 'ENOENT') {
        this.state.waiting = '运行记录无法读取或保存；自动运行已停止，请检查文件权限与记录';
        this.broken = true;
      }
    }
  }
  persist() { return this.save(this.stateFile, this.state); }
  info() {
    const now = this.clock(), day = torontoDay(now);
    let next = scheduledAt(day);
    if (this.state.lastSuccessDay === day || (this.state.runs.filter(r => r.day === day && r.trigger === 'scheduled').length >= 3)) {
      const tomorrow = new Date(`${day}T12:00:00Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      next = scheduledAt(tomorrow.toISOString().slice(0, 10));
    }
    return { timeZone: TIME_ZONE, time: '09:00', nextScheduledAt: next, due: Date.parse(next) <= now.getTime(),
      lastSuccessDay: this.state.lastSuccessDay, waiting: this.state.waiting, retryAt: this.state.retryAt,
      runs: this.state.runs.slice(-30).reverse(), broken: Boolean(this.broken) };
  }
  async start(trigger = 'manual') {
    await this.ready;
    // A displayed result may still be committing its ledger. Drain that commit
    // before deciding whether this request is cached or should start a new run.
    if (this.pending && this.search.state !== 'running') await this.pending;
    if (this.pending) return { runId: this.search.runId, running: true };
    if (this.broken) throw new Error(this.state.waiting);
    const now = this.clock(), day = torontoDay(now), planned = scheduledAt(day);
    if (trigger === 'scheduled') {
      if (now < new Date(planned) || this.state.lastSuccessDay === day) return { skipped: true };
      if (this.state.runs.filter(r => r.day === day && r.trigger === 'scheduled').length >= 3) return { skipped: true, reason: '今日自动尝试已达 3 次，可手动重试' };
      if (Date.parse(this.state.retryAt) > now.getTime()) return { skipped: true };
    } else if (this.search.state === 'done' && this.search.report.dataVersion === 5 &&
      JSON.stringify(this.search.report.targetTerms) === JSON.stringify([...TARGET_TERMS]) && now - Date.parse(this.search.report.finishedAt) < 300000) return { cached: true };
    // Reserve before awaiting disk/network: manual and scheduled callers share one run.
    let release;
    this.pending = new Promise(r => { release = r; });
    const previous = this.search.report;
    try {
      if (trigger === 'scheduled' && !await this.online()) {
        this.state.waiting = '等待网络恢复；保留上次结果';
        this.state.retryAt = new Date(now.getTime() + 300000).toISOString();
        await this.persist(); release(); this.pending = null;
        return { waiting: true };
      }
      const run = { id: randomUUID(), trigger, day, scheduledAt: trigger === 'scheduled' ? planned : null,
        catchUp: trigger === 'scheduled' && now - Date.parse(planned) >= 60000, startedAt: now.toISOString(), status: 'running' };
      this.state.runs = [...this.state.runs, run].slice(-100); this.state.waiting = null; this.state.retryAt = null;
      this.search = { state: 'running', phase: '正在连接职位来源…', report: previous, runId: run.id, error: null };
      await this.persist();
      void this.execute(run, previous).finally(() => { release(); this.pending = null; });
      return { runId: run.id, running: true };
    } catch (e) {
      const run = this.state.runs.at(-1);
      if (run?.status === 'running') Object.assign(run, { status: 'failed', error: '运行记录保存失败，搜索未启动', finishedAt: this.clock().toISOString() });
      this.broken = true; this.state.waiting = '无法保存运行记录；请检查磁盘后重启';
      release(); this.pending = null; this.search = { ...this.search, state: 'error', report: previous, error: e.message }; throw e;
    }
  }
  async execute(run, previous) {
    try {
      const report = await this.discover({ onProgress: update => { this.search.phase = update.phase; } });
      const old = new Map((previous?.results || []).map(job => [job.key, job]));
      report.results = report.results.map(job => {
        const before = old.get(job.key);
        return before && jobInputHash(before) === jobInputHash(job) ? { ...job, availability: before.availability, eligibilityConfirmations: before.eligibilityConfirmations } : job;
      });
      report.runId = run.id;
      await this.save(this.file, report);
      Object.assign(run, { status: report.partial ? 'partial' : 'done', finishedAt: this.clock().toISOString(),
        count: report.results.length, added: previous ? report.results.filter(j => !old.has(j.key)).length : null,
        review: report.results.filter(j => j.decision === 'REVIEW').length, errors: report.errors || [] });
      // A manual success after 09:00 also satisfies today's automatic discovery.
      if (Date.parse(run.startedAt) >= Date.parse(scheduledAt(run.day))) this.state.lastSuccessDay = run.day;
      this.search = { state: 'done', phase: report.partial ? '搜索完成 · 部分来源不完整' : '搜索完成', report, runId: run.id, error: null };
    } catch (e) {
      Object.assign(run, { status: 'failed', error: e.message, finishedAt: this.clock().toISOString() });
      const exhausted = run.trigger === 'scheduled' && this.state.runs.filter(r => r.day === run.day && r.trigger === 'scheduled').length >= 3;
      this.state.retryAt = exhausted ? null : new Date(this.clock().getTime() + 15 * 60000).toISOString();
      this.state.waiting = exhausted ? '今日自动尝试已达 3 次，保留上次结果；可手动重试' : '搜索失败；保留上次结果';
      this.search = { state: 'error', phase: '搜索未完成', report: previous, error: e.message, runId: run.id };
    }
    try { await this.persist(); } catch { this.broken = true; this.state.waiting = '运行记录保存失败，自动运行已停止；请检查磁盘后重启'; }
  }
  async saveEvidence(report) { await this.save(this.file, report); }
}
