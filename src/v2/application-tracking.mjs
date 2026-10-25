import { createHash, randomUUID } from 'node:crypto';
import { durationFacts } from '../duration-facts.mjs';
import { startTerms } from '../start-terms.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
// What happened after a real submission. Submission itself stays in the submission tables.
export const STAGES = [
  ['submitted', '已提交'],
  ['oa', '测评/OA'],
  ['interview', '面试'],
  ['offer', 'Offer'],
  ['accepted', '已接受'],
  ['rejected', '被拒'],
  ['declined', '已婉拒'],
  ['withdrawn', '主动撤回'],
  ['ghosted', '无回音']
];
const LABELS = new Map(STAGES);
export const ENDED = new Set(['accepted', 'rejected', 'declined', 'withdrawn', 'ghosted']);
// Only a reminder: nothing changes a stage automatically.
export const FOLLOW_UP_DAYS = 30;
const FACT_FIELDS = ['company', 'title', 'location', 'url', 'salary', 'term', 'duration', 'workMode'];
const SEASONS = { winter: 'Winter', summer: 'Summer', fall: 'Fall' };

export function installApplicationTracking(db) {
  db.exec(`
 CREATE TABLE IF NOT EXISTS application_tracking(user_id TEXT NOT NULL REFERENCES users(id),job_id TEXT NOT NULL REFERENCES jobs(id),revision INTEGER NOT NULL,next_step TEXT NOT NULL,due TEXT NOT NULL,contact TEXT NOT NULL,notes TEXT NOT NULL,facts TEXT,updated INTEGER NOT NULL,PRIMARY KEY(user_id,job_id));
 CREATE TABLE IF NOT EXISTS application_tracking_changes(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),job_id TEXT NOT NULL REFERENCES jobs(id),revision INTEGER NOT NULL,before_snapshot TEXT NOT NULL,after_snapshot TEXT NOT NULL,created INTEGER NOT NULL,request_id TEXT NOT NULL,request_hash TEXT NOT NULL,UNIQUE(user_id,request_id));
 CREATE TABLE IF NOT EXISTS application_stage_events(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),job_id TEXT NOT NULL REFERENCES jobs(id),stage TEXT NOT NULL,date TEXT NOT NULL,note TEXT NOT NULL,created INTEGER NOT NULL,voided INTEGER,void_reason TEXT,request_id TEXT NOT NULL,request_hash TEXT NOT NULL,UNIQUE(user_id,request_id));
`);
}

// Posting facts as the opportunity list shows them; empty strings when unknown.
export function postingFacts(job, opportunity) {
  const source = opportunity || {},
    terms = opportunity ? startTerms(opportunity) : [];
  const info = opportunity ? durationFacts(opportunity) : { options: [], ranges: [] };
  const duration = info.options.length
    ? info.options.join('/') + ' 个月'
    : info.ranges.length
      ? info.ranges.map(r => `${r.min}–${r.max} ${r.unit === 'weeks' ? '周' : '个月'}`).join('；')
      : '';
  const salary = String(source.salary || '').trim();
  return {
    company: job.company,
    title: job.title,
    location: job.location || String(source.location || ''),
    url: job.url || String(source.url || ''),
    salary: salary === '未披露' ? '' : salary,
    term: terms.map(t => [SEASONS[t.season] || t.season, t.year].filter(Boolean).join(' ')).join(' / '),
    duration,
    workMode: { remote: '远程', hybrid: '混合', onsite: '现场' }[source.workMode] || ''
  };
}

const today = (now, timezoneOffset) =>
  timezoneOffset === undefined
    ? new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Toronto',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(new Date(now))
    : new Date(now - timezoneOffset * 60000).toISOString().slice(0, 10);
const validDay = value =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;

export class ApplicationTracking {
  constructor(store) {
    this.store = store;
    this.db = store.db;
  }
  opportunityByJob(owner) {
    const byJob = new Map();
    for (const item of this.store.opportunities(owner))
      for (const id of item.draftIds || []) if (!byJob.has(id)) byJob.set(id, item);
    return byJob;
  }
  row(owner, jobId) {
    return this.db
      .prepare(
        'SELECT revision,next_step nextStep,due,contact,notes,facts,updated FROM application_tracking WHERE user_id=? AND job_id=?'
      )
      .get(owner, jobId);
  }
  events(owner, jobId) {
    return this.db
      .prepare(
        'SELECT id,stage,date,note,created,voided,void_reason voidReason FROM application_stage_events WHERE user_id=? AND job_id=? ORDER BY date,created'
      )
      .all(owner, jobId)
      .map(row => ({ ...row, label: LABELS.get(row.stage) }));
  }
  // Keeps the posting as it looked when it was applied to; listings disappear after closing.
  captureFacts(owner, jobId, byJob = null) {
    const existing = this.row(owner, jobId);
    if (existing?.facts) return;
    const job = this.store.job(owner, jobId),
      facts = JSON.stringify({ ...postingFacts(job, (byJob || this.opportunityByJob(owner)).get(jobId)), capturedAt: this.store.now() });
    if (existing)
      this.db.prepare('UPDATE application_tracking SET facts=? WHERE user_id=? AND job_id=?').run(facts, owner, jobId);
    else
      this.db
        .prepare('INSERT INTO application_tracking VALUES (?,?,0,\'\',\'\',\'\',\'\',?,?)')
        .run(owner, jobId, facts, this.store.now());
  }
  // Read projection added to each applications() row.
  summary(owner, row, byJob) {
    const record = this.row(owner, row.jobId),
      events = this.events(owner, row.jobId),
      live = events.filter(event => !event.voided);
    const latest = live.at(-1),
      stage = latest?.stage || 'submitted';
    const job = this.store.job(owner, row.jobId),
      current = postingFacts(job, byJob.get(row.jobId)),
      saved = record?.facts ? JSON.parse(record.facts) : null;
    // A snapshot wins field by field; the current posting only fills gaps it left empty.
    const facts = Object.fromEntries(FACT_FIELDS.map(field => [field, saved?.[field] || current[field] || '']));
    const dates = row.submissions.map(s => s.date).filter(Boolean).sort(),
      appliedDate = dates[0] || '';
    const now = today(this.store.now());
    const waited = appliedDate ? Math.floor((Date.parse(now) - Date.parse(appliedDate)) / 86400000) : null;
    const followUp = stage === 'submitted' && waited !== null && waited >= FOLLOW_UP_DAYS;
    const systemNotes = [];
    for (const missing of row.channelProgress?.missing || [])
      systemNotes.push((missing === 'school' ? '学校 Portal' : '官网') + '尚未记录提交');
    if (row.channelProgress?.employer === '待确认') systemNotes.push('学校已提交，需核对是否还要官网申请');
    if (!appliedDate) systemNotes.push('申请日期未知（来自学校 Portal 状态）');
    if (!facts.term) systemNotes.push('学期未能从岗位信息确认');
    if (followUp) systemNotes.push(`已提交 ${waited} 天仍无进展，可考虑跟进或标记无回音`);
    return {
      revision: record?.revision ?? 0,
      stage,
      stageLabel: LABELS.get(stage),
      stageDate: latest?.date || appliedDate,
      ended: ENDED.has(stage),
      events,
      nextStep: record?.nextStep || '',
      due: record?.due || '',
      contact: record?.contact || '',
      notes: record?.notes || '',
      facts,
      factsSource: saved ? 'snapshot' : 'current',
      appliedDate,
      waited,
      followUp,
      systemNotes
    };
  }
  submitted(owner, jobId) {
    this.store.job(owner, jobId);
    if (!this.store.submittedJobIds(owner).has(jobId)) fail(409, '只有已记录提交的岗位才能记录后续进展');
  }
  // Retries with the same request id are answered without writing again.
  retried(table, owner, requestId, fingerprint) {
    const retry = this.db.prepare(`SELECT request_hash FROM ${table} WHERE user_id=? AND request_id=?`).get(owner, requestId);
    if (retry && retry.request_hash !== fingerprint) fail(409, '操作标识已用于其他更改');
    return Boolean(retry);
  }
  saveDetails(owner, jobId, input, { textField, requestIdentifier }) {
    this.submitted(owner, jobId);
    if (!Number.isSafeInteger(input.revision) || input.revision < 0) fail(400, '记录版本不正确');
    const requestId = requestIdentifier(input.requestId);
    const next = {
      nextStep: textField(input.nextStep ?? '', 500),
      due: textField(input.due ?? '', 16),
      contact: textField(input.contact ?? '', 500),
      notes: textField(input.notes ?? '', 5000)
    };
    if (next.due && !(validDay(next.due.slice(0, 10)) && /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/.test(next.due)))
      fail(400, '截止时间格式应为 YYYY-MM-DD 或 YYYY-MM-DDTHH:MM');
    const fingerprint = hash({ jobId, ...next, revision: input.revision });
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (!this.retried('application_tracking_changes', owner, requestId, fingerprint)) {
        this.captureFacts(owner, jobId);
        const record = this.row(owner, jobId);
        if (record.revision !== input.revision) fail(409, '记录已在别处更新，请刷新后核对；输入已保留');
        const before = { nextStep: record.nextStep, due: record.due, contact: record.contact, notes: record.notes };
        if (JSON.stringify(before) === JSON.stringify(next)) fail(400, '内容没有变化');
        const revision = record.revision + 1;
        this.db
          .prepare('INSERT INTO application_tracking_changes VALUES (?,?,?,?,?,?,?,?,?)')
          .run(
            randomUUID(),
            owner,
            jobId,
            revision,
            JSON.stringify(before),
            JSON.stringify(next),
            this.store.now(),
            requestId,
            fingerprint
          );
        this.db
          .prepare(
            'UPDATE application_tracking SET revision=?,next_step=?,due=?,contact=?,notes=?,updated=? WHERE user_id=? AND job_id=?'
          )
          .run(revision, next.nextStep, next.due, next.contact, next.notes, this.store.now(), owner, jobId);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  addEvent(owner, jobId, input, { textField, requestIdentifier }) {
    this.submitted(owner, jobId);
    const requestId = requestIdentifier(input.requestId);
    if (!LABELS.has(input.stage) || input.stage === 'submitted')
      fail(400, '请选择提交后的进展阶段；提交本身在提交记录里更正');
    if (input.timezoneOffset !== undefined && (!Number.isInteger(input.timezoneOffset) || Math.abs(input.timezoneOffset) > 840))
      fail(400, '本地时区偏移不正确');
    const date = textField(input.date, 10, true),
      note = textField(input.note ?? '', 500);
    if (!validDay(date) || date > today(this.store.now(), input.timezoneOffset))
      fail(400, '请填写这一阶段实际发生的日期，不能是未来日期');
    const fingerprint = hash({ jobId, stage: input.stage, date, note });
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (!this.retried('application_stage_events', owner, requestId, fingerprint)) {
        this.captureFacts(owner, jobId);
        this.db
          .prepare('INSERT INTO application_stage_events VALUES (?,?,?,?,?,?,?,NULL,NULL,?,?)')
          .run(randomUUID(), owner, jobId, input.stage, date, note, this.store.now(), requestId, fingerprint);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  // Mistaken entries are voided, never deleted, so the timeline keeps what was recorded.
  voidEvent(owner, jobId, eventId, input, { textField }) {
    this.submitted(owner, jobId);
    const reason = textField(input.reason || '本人撤销误记的阶段', 200, true);
    const event = this.db
      .prepare('SELECT voided FROM application_stage_events WHERE user_id=? AND job_id=? AND id=?')
      .get(owner, jobId, eventId);
    if (!event) fail(404, '未找到这条进展记录');
    if (event.voided) return;
    this.db
      .prepare('UPDATE application_stage_events SET voided=?,void_reason=? WHERE user_id=? AND id=?')
      .run(this.store.now(), reason, owner, eventId);
  }
  exportRows(owner) {
    const rows = (table, columns) =>
      this.db.prepare(`SELECT ${columns} FROM ${table} WHERE user_id=? ORDER BY rowid`).all(owner);
    return {
      applicationTracking: rows('application_tracking', 'job_id,revision,next_step,due,contact,notes,facts,updated').map(
        row => ({ ...row, facts: row.facts ? JSON.parse(row.facts) : null })
      ),
      applicationTrackingChanges: rows(
        'application_tracking_changes',
        'id,job_id,revision,before_snapshot,after_snapshot,created'
      ).map(({ before_snapshot, after_snapshot, ...row }) => ({
        ...row,
        before: JSON.parse(before_snapshot),
        after: JSON.parse(after_snapshot)
      })),
      applicationStageEvents: rows('application_stage_events', 'id,job_id,stage,date,note,created,voided,void_reason')
    };
  }
}
