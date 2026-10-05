import { randomUUID } from 'node:crypto';
import { torontoDay, scheduledAt } from '../discovery-runner.mjs';
import { fail } from './store.mjs';

// One runner per local workspace service. The HTTP listener owns the single process.
export class CatalogueRunner {
  constructor(store, { discover, online = async () => true, configured = false }) {
    Object.assign(this, { store, discover, online, configured });
    this.pending = null;
    store.db.exec('CREATE TABLE IF NOT EXISTS discovery_state (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL)');
    this.state = JSON.parse(store.db.prepare('SELECT payload FROM discovery_state WHERE id=1').get()?.payload ?? '{"enabled":false,"runs":[],"lastSuccessDay":null,"retryAt":null,"waiting":null}');
    for (const run of this.state.runs) if (run.status === 'running') {
      run.status = 'interrupted'; run.finishedAt = new Date(store.now()).toISOString();
      this.state.waiting = '上次运行被中断，保留原结果'; this.state.retryAt = store.now() + 15 * 60000;
    }
    this.persist();
  }
  persist() {
    try { this.store.db.prepare('INSERT INTO discovery_state VALUES (1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(JSON.stringify(this.state)); }
    catch (error) { this.broken = true; throw error; }
  }
  status() {
    const now = new Date(this.store.now()), day = torontoDay(now);
    const tomorrow = torontoDay(new Date(Date.parse(`${day}T12:00:00Z`) + 86400000));
    return { configured: this.configured, broken: Boolean(this.broken), enabled: this.state.enabled, running: Boolean(this.pending), timeZone: 'America/Toronto', time: '09:00',
      due: this.state.lastSuccessDay !== day && now >= new Date(scheduledAt(day)),
      nextScheduledAt: scheduledAt(this.state.lastSuccessDay === day ? tomorrow : day), ...this.state };
  }
  setEnabled(enabled) {
    if (this.broken) fail(503, '运行记录异常，请修复存储后重启');
    if (typeof enabled !== 'boolean') fail(400, '日程开关无效');
    if (!this.configured) fail(409, '尚未配置独立后台入口，不能启用');
    this.state.enabled = enabled;
    this.persist(); return this.status();
  }
  start(trigger = 'manual') {
    if (this.broken) fail(503, '运行记录异常，请修复存储后重启');
    if (this.pending) fail(409, '公开列表正在刷新，请稍后查看');
    const now = this.store.now(), day = torontoDay(new Date(now)), planned = Date.parse(scheduledAt(day));
    if (trigger === 'scheduled') {
      if (!this.configured || !this.state.enabled || now < planned || this.state.lastSuccessDay === day) return Promise.resolve({ skipped: true });
      if (this.state.runs.filter(r => r.day === day && r.trigger === 'scheduled').length >= 3) return Promise.resolve({ skipped: true, reason: '今日自动尝试已达3次' });
      if (this.state.retryAt > now) return Promise.resolve({ waiting: true });
    } else {
      const last = this.state.runs.at(-1);
      if (last && now - Date.parse(last.startedAt) < 60000) fail(429, '请间隔一分钟后再刷新公开来源');
    }
    // Reserve synchronously, before network awaits.
    this.pending = Promise.resolve().then(() => this.execute(trigger, day, now, planned)).finally(() => { this.pending = null; });
    return this.pending;
  }
  async execute(trigger, day, started, planned) {
    if (trigger === 'scheduled' && !await this.online()) {
      this.state.waiting = '等待网络恢复，保留上次结果'; this.state.retryAt = this.store.now() + 5 * 60000; this.persist();
      return { waiting: true };
    }
    // A pause while connectivity is being checked prevents starting a search.
    if (trigger === 'scheduled' && !this.state.enabled) return { skipped: true };
    const run = { id: randomUUID(), trigger, day, catchUp: trigger === 'scheduled' && started - planned >= 60000,
      startedAt: new Date(started).toISOString(), status: 'running' };
    this.state.runs = [...this.state.runs, run].slice(-100); this.state.waiting = null; this.state.retryAt = null;
    this.persist();
    try {
      const result = await this.discover();
      if (!result.sources?.some(s => s.status === 'complete' || s.status === 'partial')) throw Error('所有来源均未成功读取');
      const old = new Set(this.store.catalogue().jobs.map(j => j.id));
      this.store.db.exec('BEGIN IMMEDIATE');
      try {
        const saved = this.store.saveCatalogue(result);
        Object.assign(run, { status: result.sources.every(s => s.status === 'complete') ? 'done' : 'partial',
          count: saved.jobs.length, added: saved.jobs.filter(j => !old.has(j.id)).length,
          sources: result.sources, finishedAt: new Date(this.store.now()).toISOString() });
        if (started >= planned) this.state.lastSuccessDay = day;
        this.persist(); this.store.db.exec('COMMIT'); return saved;
      } catch (error) { this.store.db.exec('ROLLBACK'); throw error; }
    } catch (error) {
      // Reload committed state so a failed completion transaction cannot claim success.
      this.state = JSON.parse(this.store.db.prepare('SELECT payload FROM discovery_state WHERE id=1').get().payload);
      Object.assign(this.state.runs.find(r => r.id === run.id), { status: 'failed', finishedAt: new Date(this.store.now()).toISOString(), error: '搜索未完成，保留上次结果' });
      this.state.retryAt = this.store.now() + 15 * 60000; this.state.waiting = '搜索未完成，保留上次结果'; this.persist();
      fail(503, '搜索未完成，保留上次结果，可稍后重试');
    }
  }
}
