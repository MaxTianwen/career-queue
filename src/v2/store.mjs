import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { previewSchool, schoolHash } from './school.mjs';
import { schoolDeadline } from '../portal-paste.mjs';

const derive = promisify(scrypt);
const hash = value => createHash('sha256').update(value).digest('hex');
const key = (password, salt) => derive(password, salt, 64, { N: 65536, r: 8, p: 2, maxmem: 96 * 1024 * 1024 });
export const SESSION_MS = 8 * 60 * 60 * 1000;
export const FILE_BYTES = 5 * 1024 * 1024;
export function fail(status, message) { throw Object.assign(new Error(message), { status }); }
export function textField(value, max, required = false) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail(400, '字段内容或长度不正确');
  const result = value.trim();
  if (required && !result) fail(400, '请填写必填内容');
  return result;
}
function credentials(input) {
  const username = textField(input.username, 40, true).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_.-]{2,39}$/.test(username)) fail(400, '账号需为 3–40 位英文、数字、点、横线或下划线');
  if (typeof input.password !== 'string' || input.password.length < 12 || input.password.length > 128) fail(400, '密码需为 12–128 个字符');
  return { username, password: input.password };
}
function jobFields(input) {
  const fields = Object.fromEntries(['company', 'title', 'location', 'url', 'notes'].map(name => [name, textField(input[name] ?? '', name === 'notes' ? 5000 : name === 'url' ? 2000 : 200, ['company', 'title'].includes(name))]));
  fields.jd = textField(input.jd ?? '', 60000);
  if (fields.url) {
    let url;
    try { url = new URL(fields.url); } catch { fail(400, '请填写完整的 HTTPS 岗位链接'); }
    if (url.protocol !== 'https:' || url.username || url.password) fail(400, '岗位链接仅支持无账号信息的 HTTPS 地址');
    fields.url = url.href;
  }
  return fields;
}
function submissionDate(value, now) {
  const date = textField(value, 10, true);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || date > new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now))) fail(400, '请填写有效的实际提交日期，不能是未来日期');
  return date;
}
function requestIdentifier(value) {
  const id = textField(value, 36, true);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) fail(400, '操作标识不正确，请刷新后重试');
  return id;
}

// This store is independent of v1's Notion, knowledge base and material directories.
// Owner IDs always come from a validated session, never request body fields.
export class WorkspaceStore {
  constructor(filename, { now = Date.now, readOnly = false } = {}) {
    if (!readOnly) mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename, { readOnly });
    this.now = now;
    this.authBusy = 0;
    if (readOnly) return;
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, salt TEXT NOT NULL,
        password_hash TEXT NOT NULL, preferences TEXT NOT NULL DEFAULT '{}');
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS auth_attempts (at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), company TEXT NOT NULL,
        title TEXT NOT NULL, location TEXT NOT NULL, url TEXT NOT NULL, notes TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS jobs_owner ON jobs(user_id);
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL,
        format TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, created INTEGER NOT NULL, bytes BLOB NOT NULL);
      CREATE INDEX IF NOT EXISTS files_owner ON files(user_id);`);
    if (!this.db.prepare('PRAGMA table_info(users)').all().some(column => column.name === 'role')) {
      this.db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member','admin'))");
    }
    this.db.exec(`CREATE TABLE IF NOT EXISTS settings (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
      INSERT OR IGNORE INTO settings VALUES ('registration_open', 1);`);
    if (!this.db.prepare('PRAGMA table_info(jobs)').all().some(column => column.name === 'jd')) this.db.exec("ALTER TABLE jobs ADD COLUMN jd TEXT NOT NULL DEFAULT ''");
    this.db.exec(`CREATE TABLE IF NOT EXISTS resume_text (file_id TEXT PRIMARY KEY REFERENCES files(id), user_id TEXT NOT NULL REFERENCES users(id), text TEXT NOT NULL, text_hash TEXT NOT NULL, pages INTEGER, parser TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS active_resume (user_id TEXT PRIMARY KEY REFERENCES users(id), file_id TEXT NOT NULL REFERENCES files(id));
      CREATE TABLE IF NOT EXISTS catalogue (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL);`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS application_plans (job_id TEXT PRIMARY KEY REFERENCES jobs(id), user_id TEXT NOT NULL REFERENCES users(id), channel TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS pdf_reviews (file_id TEXT PRIMARY KEY REFERENCES files(id), user_id TEXT NOT NULL REFERENCES users(id), pages INTEGER NOT NULL, session_key TEXT NOT NULL, viewed INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS materials (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), job_id TEXT NOT NULL REFERENCES jobs(id), fingerprint TEXT NOT NULL, snapshot TEXT NOT NULL, created INTEGER NOT NULL, UNIQUE(user_id,job_id,fingerprint));
      CREATE TABLE IF NOT EXISTS submissions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), job_id TEXT NOT NULL REFERENCES jobs(id), channel TEXT NOT NULL, material_id TEXT NOT NULL REFERENCES materials(id), submitted_date TEXT NOT NULL, receipt TEXT NOT NULL, created INTEGER NOT NULL, UNIQUE(user_id,job_id,channel));`);
    const submissionColumns = this.db.prepare('PRAGMA table_info(submissions)').all();
    if (!submissionColumns.some(column => column.name === 'request_id')) this.db.exec('ALTER TABLE submissions ADD COLUMN request_id TEXT');
    if (!submissionColumns.some(column => column.name === 'request_hash')) this.db.exec('ALTER TABLE submissions ADD COLUMN request_hash TEXT');
    this.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS submissions_request ON submissions(user_id,request_id);
      CREATE TABLE IF NOT EXISTS submission_corrections (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), job_id TEXT NOT NULL REFERENCES jobs(id),
        submission_id TEXT NOT NULL REFERENCES submissions(id), revision INTEGER NOT NULL, request_id TEXT NOT NULL,
        before_snapshot TEXT NOT NULL, after_snapshot TEXT NOT NULL, reason TEXT NOT NULL, actor TEXT NOT NULL, created INTEGER NOT NULL,
        UNIQUE(user_id,request_id), UNIQUE(submission_id,revision));`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS generated_resumes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), job_id TEXT NOT NULL REFERENCES jobs(id), fingerprint TEXT NOT NULL, pdf_id TEXT NOT NULL REFERENCES files(id), docx_id TEXT NOT NULL REFERENCES files(id), snapshot TEXT NOT NULL, created INTEGER NOT NULL, UNIQUE(user_id,job_id,fingerprint));`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS school_links (user_id TEXT NOT NULL REFERENCES users(id), school_id TEXT NOT NULL, job_id TEXT NOT NULL REFERENCES jobs(id), snapshot TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(user_id,school_id), UNIQUE(user_id,job_id));
      CREATE TABLE IF NOT EXISTS school_imports (user_id TEXT NOT NULL REFERENCES users(id), request_id TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(user_id,request_id));`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS school_changes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), school_id TEXT NOT NULL,
      action TEXT NOT NULL, before_snapshot TEXT NOT NULL, after_snapshot TEXT NOT NULL, reason TEXT NOT NULL, actor TEXT NOT NULL, created INTEGER NOT NULL,
      request_id TEXT NOT NULL, request_hash TEXT NOT NULL, UNIQUE(user_id,request_id));
      CREATE TABLE IF NOT EXISTS school_submission_sources (submission_id TEXT PRIMARY KEY REFERENCES submissions(id), user_id TEXT NOT NULL REFERENCES users(id),
        school_id TEXT NOT NULL, snapshot TEXT NOT NULL, basis TEXT NOT NULL, captured INTEGER NOT NULL);`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS migration_receipts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
      source_key TEXT NOT NULL, job_id TEXT NOT NULL REFERENCES jobs(id), fingerprint TEXT NOT NULL, snapshot TEXT NOT NULL,
      created INTEGER NOT NULL, UNIQUE(user_id,source_key));`);
    this.db.exec('CREATE TABLE IF NOT EXISTS application_preparation (job_id TEXT PRIMARY KEY REFERENCES jobs(id), user_id TEXT NOT NULL REFERENCES users(id), revision INTEGER NOT NULL, notes TEXT NOT NULL, basis TEXT NOT NULL, reviewed INTEGER NOT NULL, updated INTEGER NOT NULL)');
    this.db.exec('CREATE TABLE IF NOT EXISTS question_drafts (job_id TEXT PRIMARY KEY REFERENCES jobs(id), user_id TEXT NOT NULL REFERENCES users(id), revision INTEGER NOT NULL, basis TEXT NOT NULL, snapshot TEXT NOT NULL, updated INTEGER NOT NULL)');
    if (!this.db.prepare('PRAGMA table_info(jobs)').all().some(column => column.name === 'hidden')) this.db.exec('ALTER TABLE jobs ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0');
    if (!this.db.prepare('PRAGMA table_info(jobs)').all().some(column => column.name === 'returned')) this.db.exec('ALTER TABLE jobs ADD COLUMN returned INTEGER NOT NULL DEFAULT 0');
    this.db.exec('CREATE TABLE IF NOT EXISTS school_opportunities (user_id TEXT NOT NULL REFERENCES users(id),school_id TEXT NOT NULL,snapshot TEXT NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(user_id,school_id))');
    this.db.exec('CREATE TABLE IF NOT EXISTS question_history (job_id TEXT NOT NULL REFERENCES jobs(id), user_id TEXT NOT NULL REFERENCES users(id), revision INTEGER NOT NULL, basis TEXT NOT NULL, snapshot TEXT NOT NULL, updated INTEGER NOT NULL, archived INTEGER NOT NULL, PRIMARY KEY(job_id,revision))');
    // Record the association known at upgrade, never claim it existed at the submission date.
    this.db.prepare(`INSERT OR IGNORE INTO school_submission_sources
      SELECT s.id,s.user_id,l.school_id,l.snapshot,'existing-association',? FROM submissions s
      JOIN school_links l ON l.user_id=s.user_id AND l.job_id=s.job_id WHERE s.channel='school'`).run(this.now());
  }
  close() { this.db.close(); }
  migrationReceipts(owner) {
    return this.db.prepare('SELECT id,source_key sourceKey,job_id jobId,snapshot,created FROM migration_receipts WHERE user_id=? ORDER BY created,id').all(owner)
      .map(({ snapshot, ...row }) => ({ ...row, ...JSON.parse(snapshot) }));
  }
  // Operator-only provenance entry; never imports files, reviews or submission state.
  recordMigration(owner, input) {
    const job = this.job(owner, input.jobId), sourceKey = textField(input.sourceKey, 24, true);
    if (!/^[a-f0-9]{24}$/.test(sourceKey) || input.source !== 'v1-notion') fail(400, '迁入来源无效');
    const source = {};
    for (const field of ['company', 'title', 'location', 'url', 'notes', 'jd', 'term', 'status'])
      source[field] = textField(input.original?.[field] ?? '', field === 'jd' ? 60000 : field === 'notes' ? 5000 : field === 'url' ? 2000 : 200, ['company', 'title'].includes(field));
    if (!Array.isArray(input.documents) || input.documents.length > 20) fail(400, '历史文件映射无效');
    const ids = new Set();
    const documents = input.documents.map(item => {
      const file = this.file(owner, item.fileId);
      if (ids.has(file.id) || item.sha256 !== file.sha256) fail(409, '历史文件重复或哈希不符');
      ids.add(file.id);
      return { fileId: file.id, name: file.name, sha256: file.sha256, format: file.format,
        version: textField(item.version, 100, true), baseline: textField(item.baseline ?? '未知旧基准', 200, true),
        classification: 'historical-generated-unreviewed' };
    });
    const snapshot = { source: 'v1-notion', original: source, documents, targetAtMigration: { company: job.company, title: job.title } };
    if (input.migration) {
      if (![input.migration.bundleHash, input.migration.previewFingerprint].every(x => /^[a-f0-9]{64}$/.test(x ?? ''))) fail(400, '迁入预览标识无效');
      snapshot.migration = { bundleHash: input.migration.bundleHash, previewFingerprint: input.migration.previewFingerprint };
    }
    const fingerprint = hash(JSON.stringify({ jobId: job.id, source, documents, ...(snapshot.migration ? { migration: snapshot.migration } : {}) }));
    const existing = this.db.prepare('SELECT fingerprint FROM migration_receipts WHERE user_id=? AND source_key=?').get(owner, sourceKey);
    if (existing && existing.fingerprint !== fingerprint) fail(409, '来源或映射已变化，不能覆盖迁入记录');
    if (!existing) this.db.prepare('INSERT INTO migration_receipts VALUES (?,?,?,?,?,?,?)').run(randomUUID(), owner, sourceKey, job.id, fingerprint, JSON.stringify(snapshot), this.now());
    return this.migrationReceipts(owner).find(row => row.sourceKey === sourceKey);
  }
  registrationOpen() { return this.db.prepare("SELECT value FROM settings WHERE name='registration_open'").get().value === 1; }
  setRegistration(owner, open) {
    if (this.db.prepare('SELECT role FROM users WHERE id=?').get(owner)?.role !== 'admin') fail(403, '仅管理员可调整注册入口');
    if (typeof open !== 'boolean') fail(400, '注册设置不正确');
    this.db.prepare("UPDATE settings SET value=? WHERE name='registration_open'").run(open ? 1 : 0);
    return { registrationOpen: this.registrationOpen() };
  }
  // Local operator entry point only: never exposed by registration or any HTTP route.
  async createAdmin(input) {
    const { username, password } = credentials(input);
    if (this.db.prepare('SELECT id FROM users WHERE username=?').get(username)) fail(409, '账号已存在，不覆盖密码或提升原账号权限');
    const salt = randomBytes(16).toString('hex'), derived = await key(password, salt), id = randomUUID();
    const result = this.db.prepare("INSERT OR IGNORE INTO users(id,username,salt,password_hash,role) VALUES (?,?,?,?,'admin')").run(id, username, salt, derived.toString('hex'));
    if (!result.changes) fail(409, '账号已存在，不覆盖密码或提升原账号权限');
    return { id, username, role: 'admin' };
  }
  reserveAuth() {
    const now = this.now();
    this.db.prepare('DELETE FROM auth_attempts WHERE at < ?').run(now - 15 * 60 * 1000);
    if (this.db.prepare('SELECT count(*) n FROM auth_attempts').get().n >= 20) fail(429, '尝试次数过多，请 15 分钟后再试');
    if (this.authBusy >= 2) fail(429, '登录处理中，请稍后再试');
    this.db.prepare('INSERT INTO auth_attempts VALUES (?)').run(now);
  }
  async authenticate(input, register = false) {
    if (register && !this.registrationOpen()) fail(403, '当前已关闭注册，请使用已有账号登录');
    this.reserveAuth();
    const { username, password } = credentials(input);
    this.authBusy++;
    try {
      let user = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username);
      const salt = user?.salt ?? randomBytes(16).toString('hex');
      const derived = await key(password, salt);
      if (register) {
        if (!this.registrationOpen()) fail(403, '当前已关闭注册，请使用已有账号登录');
        if (user) fail(409, '此账号不可注册，请换一个账号或登录');
        if (this.db.prepare('SELECT count(*) n FROM users').get().n >= 20) fail(409, '本机预览最多保存 20 个账号');
        user = { id: randomUUID(), username, role: 'member' };
        // Concurrent registration must not replace an existing account.
        const result = this.db.prepare('INSERT OR IGNORE INTO users(id,username,salt,password_hash) VALUES (?,?,?,?)').run(user.id, username, salt, derived.toString('hex'));
        if (!result.changes) fail(409, '此账号不可注册，请换一个账号或登录');
      } else if (!user || !timingSafeEqual(derived, Buffer.from(user.password_hash, 'hex'))) {
        fail(401, '账号或密码不正确');
      }
      // Password derivation yields; a local reset must not revive an old-password login.
      if (!register && this.db.prepare('SELECT password_hash FROM users WHERE id=?').get(user.id)?.password_hash !== user.password_hash) fail(401, '密码已变化，请重新登录');
      const token = randomBytes(32).toString('hex'), csrf = randomBytes(32).toString('hex');
      this.db.exec('BEGIN IMMEDIATE');
      try {
        this.db.prepare('DELETE FROM sessions WHERE user_id = ? OR expires <= ?').run(user.id, this.now());
        this.db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(hash(token), user.id, csrf, this.now() + SESSION_MS);
        this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
      return { token, csrf, expires: this.now() + SESSION_MS, user: { id: user.id, username: user.username, role: user.role } };
    } finally { this.authBusy--; }
  }
  session(token) {
    if (!/^[a-f0-9]{64}$/.test(token ?? '')) return null;
    return this.db.prepare(`SELECT s.user_id id, u.username, u.role, s.csrf, s.expires FROM sessions s
      JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>?`).get(hash(token), this.now()) ?? null;
  }
  logout(token) { this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(token)); }
  replacePassword(user, salt, derived, token) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (token && this.session(token)?.id !== user.id) fail(401, '会话已失效，请重新登录');
      const changed = this.db.prepare('UPDATE users SET salt=?,password_hash=? WHERE id=? AND password_hash=?').run(salt, derived.toString('hex'), user.id, user.password_hash);
      if (!changed.changes) fail(409, '密码已被其他操作更新，请重新登录或重试');
      this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
      this.db.prepare('DELETE FROM pdf_reviews WHERE user_id=?').run(user.id);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  async changePassword(token, input) {
    const session = this.session(token);
    if (!session) fail(401, '请重新登录');
    this.reserveAuth();
    const { password } = credentials({ username: session.username, password: input.newPassword });
    credentials({ username: session.username, password: input.currentPassword });
    if (password !== input.confirmPassword) fail(400, '两次新密码不一致');
    if (password === input.currentPassword) fail(400, '新密码应与当前密码不同');
    this.authBusy++;
    try {
      const user = this.db.prepare('SELECT * FROM users WHERE id=?').get(session.id);
      const current = await key(input.currentPassword, user.salt);
      if (!timingSafeEqual(current, Buffer.from(user.password_hash, 'hex'))) fail(400, '当前密码不正确，密码未修改');
      const salt = randomBytes(16).toString('hex'), derived = await key(password, salt);
      this.replacePassword(user, salt, derived, token);
      return { ok: true };
    } finally { this.authBusy--; }
  }
  // Local filesystem operator only; no HTTP route calls this method.
  async resetPassword(input) {
    const { username, password } = credentials(input);
    const user = this.db.prepare('SELECT * FROM users WHERE username=?').get(username);
    if (!user) fail(404, '账号不存在，未创建新账号');
    const salt = randomBytes(16).toString('hex'), derived = await key(password, salt);
    this.replacePassword(user, salt, derived);
    return { username: user.username };
  }
  preferences(owner, input) {
    if (input !== undefined) {
      const direction = textField(input.direction ?? '', 10);
      if (!['', 'cs', 'data', 'mixed'].includes(direction)) fail(400, '岗位方向不正确');
      const preferences = { direction, locations: textField(input.locations ?? '', 300), jobTypes: textField(input.jobTypes ?? '', 300) };
      this.db.prepare('UPDATE users SET preferences=? WHERE id=?').run(JSON.stringify(preferences), owner);
    }
    return JSON.parse(this.db.prepare('SELECT preferences FROM users WHERE id=?').get(owner).preferences);
  }
  setJobHidden(owner, id, hidden) {
    this.job(owner, id);
    if (typeof hidden !== 'boolean') fail(400, '隐藏状态必须为布尔值');
    this.db.prepare('UPDATE jobs SET hidden=?,returned=0 WHERE user_id=? AND id=?').run(Number(hidden), owner, id);
    return this.job(owner, id);
  }
  returnJob(owner, id) {
    this.job(owner, id);
    this.db.prepare('UPDATE jobs SET returned=1,hidden=0 WHERE user_id=? AND id=?').run(owner,id);
    return this.job(owner,id);
  }
  jobs(owner) { return this.db.prepare('SELECT id,company,title,location,url,notes,created,jd,hidden,returned,(SELECT school_id FROM school_links WHERE school_links.job_id=jobs.id AND school_links.user_id=jobs.user_id LIMIT 1) schoolId FROM jobs WHERE user_id=? ORDER BY created DESC,id').all(owner); }
  schoolLinks(owner) {
    return this.db.prepare('SELECT school_id schoolId,job_id jobId,snapshot,created FROM school_links WHERE user_id=? ORDER BY rowid').all(owner)
      .map(({ snapshot, ...link }) => ({ ...link, row: JSON.parse(snapshot), revision: schoolHash({ link, snapshot,
        event: this.db.prepare('SELECT id FROM school_changes WHERE user_id=? AND school_id=? ORDER BY rowid DESC LIMIT 1').get(owner, link.schoolId)?.id }) }));
  }
  schoolHistory(owner) {
    return this.db.prepare('SELECT id,school_id schoolId,action,before_snapshot,after_snapshot,reason,actor,created FROM school_changes WHERE user_id=? ORDER BY rowid').all(owner)
      .map(({ before_snapshot, after_snapshot, ...row }) => ({ ...row, before: JSON.parse(before_snapshot), after: JSON.parse(after_snapshot) }));
  }
  schoolSubmissionSources(owner, schoolId = null) {
    return this.db.prepare(`SELECT x.submission_id submissionId,x.school_id schoolId,x.snapshot,x.basis,x.captured,s.job_id jobId,s.channel,s.submitted_date date
      FROM school_submission_sources x JOIN submissions s ON s.id=x.submission_id WHERE x.user_id=? ORDER BY x.rowid`).all(owner)
      .filter(row => schoolId === null || row.schoolId === schoolId).map(({ snapshot, ...row }) => ({ ...row, row: JSON.parse(snapshot) }));
  }
  captureSchoolSubmission(owner, jobId, basis) {
    this.db.prepare(`INSERT OR IGNORE INTO school_submission_sources
      SELECT s.id,s.user_id,l.school_id,l.snapshot,?,? FROM submissions s
      JOIN school_links l ON l.user_id=s.user_id AND l.job_id=s.job_id WHERE s.user_id=? AND s.job_id=? AND s.channel='school'`).run(basis, this.now(), owner, jobId);
  }
  schoolAudit(owner, schoolId, action, before, after, reason, requestId, requestHash) {
    const actor = this.db.prepare('SELECT username FROM users WHERE id=?').get(owner).username;
    this.db.prepare('INSERT INTO school_changes VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), owner, schoolId, action, JSON.stringify(before), JSON.stringify(after), reason, actor, this.now(), requestId, requestHash);
  }
  schoolRecords(owner) {
    return this.schoolLinks(owner).map(link => {
      const job = this.job(owner, link.jobId), app = this.application(owner, link.jobId);
      const sources = this.schoolSubmissionSources(owner, link.schoolId), locked = sources.some(source => source.channel === 'school');
      return { ...link, job: { id: job.id, company: job.company, title: job.title }, channel: app.channel,
        locked, sources, submissions: app.submissions.filter(record => record.channel !== 'school' || sources.some(source => source.submissionId === record.id)).map(({ channel, date }) => ({ channel, date })),
        status: !locked && app.submissions.some(record => record.channel === 'school') ? '当前 School ID 尚无学校提交记录' : app.status, required: app.required };
    });
  }
  schoolContext(owner, jobId) {
    this.job(owner, jobId);
    const link = this.schoolLinks(owner).find(link => link.jobId === jobId);
    return link ? { schoolId: link.schoolId, revision: link.revision, company: link.row.company, title: link.row.title } : null;
  }
  checkSchoolRevision(owner, jobId, revision) {
    if ((revision ?? null) !== (this.schoolContext(owner, jobId)?.revision ?? null)) fail(409, '学校关联已变化，请刷新材料区，核对 School ID 后重新确认；输入已保留');
  }
  schoolChangePreview(owner, schoolId, input) {
    const before = this.schoolLinks(owner).find(link => link.schoolId === schoolId);
    if (!before) fail(404, '未找到这个学校关联');
    if (input.revision !== before.revision) fail(409, '学校关联已变化，请取消草稿并重新打开');
    if (!['update', 'unlink', 'relink'].includes(input.action)) fail(400, '请选择维护操作');
    if (input.action !== 'update' && this.schoolSubmissionSources(owner, schoolId).some(source => source.channel === 'school')) fail(409, '此 School ID 已有学校实际提交记录，只允许更新来源资料；不能解除或改绑');
    let after = { ...before };
    if (input.action === 'unlink') after = null;
    if (input.action === 'relink') {
      const target = this.job(owner, textField(input.targetJobId, 36, true));
      if (this.schoolLinks(owner).some(link => link.jobId === target.id)) fail(409, '目标职位已有学校关联，不能覆盖');
      after.jobId = target.id;
    }
    if (input.action === 'update') {
      if (input.row?.id !== undefined && input.row.id !== schoolId) fail(400, 'School ID 不能在来源更新中改变');
      const row = {};
      for (const name of ['company', 'title', 'location', 'term', 'requisitionId', 'url', 'externalUrl', 'deadlineText', 'sourceStatus']) {
        row[name] = textField(input.row?.[name], ['url', 'externalUrl'].includes(name) ? 2000 : name === 'deadlineText' ? 100 : 200, ['company', 'title'].includes(name));
      }
      for (const name of ['url', 'externalUrl']) if (row[name]) {
        try { const url = new URL(row[name]); if (url.protocol !== 'https:' || url.username || url.password) throw new Error(); }
        catch { fail(400, '学校链接须为无账号信息的 HTTPS 地址'); }
      }
      if (row.deadlineText === before.row.deadlineText) row.deadline = before.row.deadline;
      else { try { Object.assign(row, schoolDeadline(row.deadlineText)); } catch (error) { fail(400, error.message); } }
      after.row = { ...before.row, ...row, id: schoolId };
    }
    if (schoolHash(before) === schoolHash(after) || input.action === 'update' && schoolHash(before.row) === schoolHash(after.row)) fail(400, '内容没有变化');
    const describe = link => link ? { ...link, job: this.job(owner, link.jobId) } : null;
    const plan = { schoolId, action: input.action, before: describe(before), after: describe(after) };
    return { ...plan, fingerprint: schoolHash(plan) };
  }
  changeSchool(owner, schoolId, input) {
    const reason = textField(input.reason, 500, true), requestId = requestIdentifier(input.requestId);
    if (input.confirmed !== true) fail(400, '请核对前后差异后确认');
    const requestHash = schoolHash({ schoolId, input: { ...input, requestId: undefined } });
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const retry = this.db.prepare('SELECT id,request_hash FROM school_changes WHERE user_id=? AND request_id=?').get(owner, requestId);
      if (retry) {
        if (retry.request_hash !== requestHash) fail(409, '此操作标识已用于其他内容');
        this.db.exec('COMMIT'); return { saved: true, eventId: retry.id };
      }
      const plan = this.schoolChangePreview(owner, schoolId, input);
      if (input.fingerprint !== plan.fingerprint) fail(409, '前后资料已变化，请重新预览');
      this.schoolAudit(owner, schoolId, input.action, plan.before, plan.after, reason, requestId, requestHash);
      if (!plan.after) this.db.prepare('DELETE FROM school_links WHERE user_id=? AND school_id=?').run(owner, schoolId);
      else this.db.prepare('UPDATE school_links SET job_id=?,snapshot=? WHERE user_id=? AND school_id=?').run(plan.after.jobId, JSON.stringify(plan.after.row), owner, schoolId);
      if (plan.after) this.captureSchoolSubmission(owner, plan.after.jobId, 'confirmed-association');
      this.db.exec('COMMIT'); return { saved: true };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  schoolOpportunities(owner) {
    const links=this.schoolLinks(owner);
    const items=this.db.prepare('SELECT school_id,snapshot,updated FROM school_opportunities WHERE user_id=? ORDER BY updated DESC,school_id').all(owner).map(item=>({schoolId:item.school_id,row:JSON.parse(item.snapshot),fingerprint:schoolHash(JSON.parse(item.snapshot)),updated:item.updated,jobId:links.find(link=>link.schoolId===item.school_id)?.jobId || null}));
    for(const link of links) if(!items.some(item=>item.schoolId===link.schoolId)) items.push({schoolId:link.schoolId,row:link.row,fingerprint:schoolHash(link.row),updated:link.created,jobId:link.jobId});
    return items;
  }
  syncSchoolOpportunities(owner, text) {
    textField(text,150000,true);
    const preview=this.schoolPreview(owner,text);
    if (preview.errors.length || preview.rows.some(item=>!item.row)) fail(400,'列表有无法识别的行，请修正后更新；原学校职位保留');
    const rows=preview.rows.map(item=>item.row);
    if (!rows.length || new Set(rows.map(row=>row.id)).size!==rows.length) fail(400,'没有有效职位或 School ID 重复，请核对');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const pasted of rows) {
        const row={...pasted};
        const link=this.schoolLinks(owner).find(link=>link.schoolId===row.id);
        const previous=link?.row || this.schoolOpportunities(owner).find(item=>item.schoolId===row.id)?.row;
        // Copied lists omit URLs; explicit removal remains in school maintenance.
        for (const key of ['url','externalUrl']) if(!row[key] && previous?.[key]) row[key]=previous[key];
        if(link && schoolHash(link.row)!==schoolHash(row)) {
          const job=this.job(owner,link.jobId), before={schoolId:row.id,jobId:job.id,row:link.row,job}, after={...before,row};
          this.schoolAudit(owner,row.id,'update',before,after,'本人粘贴更新学校列表',randomUUID(),schoolHash(row));
          this.db.prepare('UPDATE school_links SET snapshot=? WHERE user_id=? AND school_id=?').run(JSON.stringify(row),owner,row.id);
        }
        this.db.prepare('INSERT INTO school_opportunities VALUES (?,?,?,?) ON CONFLICT(user_id,school_id) DO UPDATE SET snapshot=excluded.snapshot,updated=excluded.updated').run(owner,row.id,JSON.stringify(row),this.now());
      }
      const nextPreview=this.schoolPreview(owner,text);
      this.db.exec('COMMIT'); return {updated:rows.length,preview:nextPreview};
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
  }
  startSchoolOpportunity(owner, schoolId, fingerprint) {
    const item=this.schoolOpportunities(owner).find(item=>item.schoolId===schoolId);
    if (!item) fail(404,'学校职位不存在');
    if (schoolHash(item.row)!==fingerprint) fail(409,'学校列表已更新，请刷新后重新选择');
    if (item.jobId) return this.job(owner,item.jobId);
    if (this.schoolSubmissionSources(owner,schoolId).some(s=>s.channel==='school')) fail(409,'已有学校提交历史，请在学校对照核查原关联');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const job=this.saveJob(owner,{company:item.row.company,title:item.row.title,location:item.row.location,url:'',jd:'',notes:''});
      this.db.prepare('INSERT INTO school_links VALUES (?,?,?,?,?)').run(owner,schoolId,job.id,JSON.stringify(item.row),this.now());
      this.schoolAudit(owner,schoolId,'link',null,{schoolId,jobId:job.id,row:item.row,job},'本人从学校职位开始准备',randomUUID(),fingerprint);
      this.db.exec('COMMIT'); return job;
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
  }
  schoolPreview(owner, text) {
    const jobs = this.jobs(owner).map(job => ({ ...job, submissions: this.application(owner, job.id).submissions.map(({ channel, date }) => ({ channel, date })) }));
    const preview = previewSchool(text, { jobs, links: this.schoolLinks(owner), catalogue: this.catalogue(), preferences: this.preferences(owner), now: new Date(this.now()) });
    return { ...preview, savedJobs: jobs.map(({ id, company, title }) => ({ id, company, title })) };
  }
  importSchool(owner, input) {
    if (input.confirmed !== true) fail(400, '请核对所选学校职位及关联目标后确认');
    textField(input.text, 150000, true);
    const text = input.text, fingerprint = textField(input.fingerprint, 64, true), requestId = requestIdentifier(input.requestId);
    if (!Array.isArray(input.selections) || !input.selections.length || input.selections.length > 100) fail(400, '请选择 1–100 条学校职位');
    const selections = input.selections.map(item => {
      if (!item || !Number.isInteger(item.index) || item.index < 0 || item.index >= 100) fail(400, '学校行号不正确');
      return { index: item.index, target: textField(item.target, 100, true) };
    });
    if (new Set(selections.map(item => item.index)).size !== selections.length) fail(400, '不能重复选择同一行');
    const requestHash = schoolHash({ text, fingerprint, selections });
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const prior = this.db.prepare('SELECT fingerprint,result FROM school_imports WHERE user_id=? AND request_id=?').get(owner, requestId);
      if (prior) {
        if (prior.fingerprint !== requestHash) fail(409, '同一保存请求的内容已改变，请重新预览');
        this.db.exec('COMMIT'); return JSON.parse(prior.result);
      }
      const preview = this.schoolPreview(owner, text);
      if (preview.fingerprint !== fingerprint) fail(409, '学校来源、已保存职位或公开结果已变化，请重新预览；已有保存不会重复创建');
      const saved = [];
      for (const selection of selections) {
        const entry = preview.rows[selection.index];
        if (!entry?.row) fail(400, '所选行无法识别，请核对原文');
        if (entry.linked) fail(409, '此学校 ID 已保存；本次不覆盖已有学校资料或改绑');
        if (this.schoolSubmissionSources(owner, entry.row.id).some(source => source.channel === 'school')) fail(409, '此学校 ID 已有实际学校提交，不能重新关联；请保留历史并核查');
        let job;
        if (selection.target === 'new') {
          job = this.saveJob(owner, { company: entry.row.company, title: entry.row.title, location: entry.row.location, url: '', jd: '', notes: '' });
        } else if (selection.target.startsWith('saved:')) {
          job = this.job(owner, selection.target.slice(6));
        } else if (selection.target.startsWith('catalogue:')) {
          const source = this.catalogue().jobs.find(job => job.id === selection.target.slice(10));
          if (!source) fail(409, '公开候选已变化，请重新预览');
          if (!entry.candidates.some(candidate => candidate.target === selection.target)) fail(400, '请选择本行预览中的公开候选');
          const matches = this.jobs(owner).filter(job => job.url === source.url);
          if (matches.length > 1) fail(409, '已有多个相同链接的职位，请明确选择已保存职位');
          job = matches[0] || this.saveJob(owner, source);
        } else fail(400, '关联目标不正确');
        if (this.db.prepare('SELECT school_id FROM school_links WHERE user_id=? AND job_id=?').get(owner, job.id)) fail(409, '目标职位已关联其他学校 ID，不覆盖或合并；请核对选择');
        this.db.prepare('INSERT INTO school_links VALUES (?,?,?,?,?)').run(owner, entry.row.id, job.id, JSON.stringify(entry.row), this.now());
        this.schoolAudit(owner, entry.row.id, 'link', null, { schoolId: entry.row.id, jobId: job.id, row: entry.row, job }, '本人确认列表关联', randomUUID(), requestHash);
        this.captureSchoolSubmission(owner, job.id, 'confirmed-association');
        saved.push({ schoolId: entry.row.id, jobId: job.id });
      }
      const result = { saved };
      this.db.prepare('INSERT INTO school_imports VALUES (?,?,?,?,?)').run(owner, requestId, requestHash, JSON.stringify(result), this.now());
      this.db.exec('COMMIT'); return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  job(owner, id) {
    const row = this.db.prepare('SELECT id,company,title,location,url,notes,created,jd,hidden,returned,(SELECT school_id FROM school_links WHERE school_links.job_id=jobs.id AND school_links.user_id=jobs.user_id LIMIT 1) schoolId FROM jobs WHERE user_id=? AND id=?').get(owner, id);
    if (!row) fail(404, '未找到这条职位');
    return row;
  }
  saveJob(owner, input, id) {
    if (id) this.job(owner, id);
    const j = jobFields(input);
    if (id) this.db.prepare('UPDATE jobs SET company=?,title=?,location=?,url=?,notes=?,jd=? WHERE user_id=? AND id=?').run(j.company, j.title, j.location, j.url, j.notes, j.jd, owner, id);
    else {
      if (this.jobs(owner).length >= 500) fail(409, '本机预览每个账号最多保存 500 条职位');
      id = randomUUID();
      this.db.prepare('INSERT INTO jobs(id,user_id,company,title,location,url,notes,created,jd) VALUES (?,?,?,?,?,?,?,?,?)').run(id, owner, j.company, j.title, j.location, j.url, j.notes, this.now(), j.jd);
    }
    return this.job(owner, id);
  }
  files(owner) { return this.db.prepare('SELECT id,name,format,size,sha256,created FROM files WHERE user_id=? ORDER BY created DESC,id').all(owner); }
  saveFile(owner, name, bytes) {
    name = textField(name, 160, true);
    const format = name.split('.').pop().toLowerCase();
    if (/[\\/]/.test(name) || !['pdf', 'docx'].includes(format)) fail(400, '请选择 PDF 或 DOCX 文件');
    if (!bytes.length || bytes.length > FILE_BYTES) fail(413, '单个文件需大于 0 且不超过 5MB');
    const signature = format === 'pdf' ? bytes.subarray(0, 5).toString() === '%PDF-' : bytes.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]));
    if (!signature) fail(400, '文件类型与内容不一致');
    const total = this.db.prepare('SELECT coalesce(sum(size),0) size,count(*) n FROM files WHERE user_id=?').get(owner);
    if (total.size + bytes.length > 20 * 1024 * 1024 || total.n >= 20) fail(409, '本机预览每人最多 20 个文件、合计 20MB');
    const id = randomUUID();
    this.db.prepare('INSERT INTO files VALUES (?,?,?,?,?,?,?,?)').run(id, owner, name, format, bytes.length, hash(bytes), this.now(), bytes);
    return this.files(owner).find(file => file.id === id);
  }
  file(owner, id) {
    const row = this.db.prepare('SELECT * FROM files WHERE user_id=? AND id=?').get(owner, id);
    if (!row) fail(404, '未找到这个文件');
    return row;
  }
  parsedResume(owner, id) {
    this.file(owner, id);
    return this.db.prepare(`SELECT r.text,r.text_hash textHash,r.pages,r.parser,f.id fileId,f.name,f.sha256 fileSha
      FROM resume_text r JOIN files f ON f.id=r.file_id WHERE r.user_id=? AND r.file_id=? AND f.user_id=?`).get(owner, id, owner) ?? null;
  }
  saveParsed(owner, id, parsed) {
    this.file(owner, id);
    const text = textField(parsed.text, 100000, true);
    if (text.replace(/\s/g, '').length < 40) fail(422, '未提取到足够文字');
    this.db.prepare('INSERT OR IGNORE INTO resume_text VALUES (?,?,?,?,?,?)').run(id, owner, text, hash(text), parsed.pages ?? null, parsed.parser);
    return this.parsedResume(owner, id);
  }
  activeResume(owner) {
    const row = this.db.prepare('SELECT file_id FROM active_resume WHERE user_id=?').get(owner);
    return row ? this.parsedResume(owner, row.file_id) : null;
  }
  activateResume(owner, input) {
    const parsed = this.parsedResume(owner, textField(input.fileId, 36, true));
    if (!parsed || input.confirmed !== true || input.textHash !== parsed.textHash || input.fileSha !== parsed.fileSha) fail(409, '请先核对当前文件的提取文字并确认启用');
    this.db.prepare('INSERT INTO active_resume VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET file_id=excluded.file_id').run(owner, parsed.fileId);
    return parsed;
  }
  clearResume(owner) { this.db.prepare('DELETE FROM active_resume WHERE user_id=?').run(owner); }
  usage(owner) {
    const files = this.db.prepare('SELECT count(*) count,coalesce(sum(size),0) bytes FROM files WHERE user_id=?').get(owner);
    return { files: { ...files, maxCount: 20, maxBytes: 20 * 1024 * 1024 }, jobs: { count: this.db.prepare('SELECT count(*) n FROM jobs WHERE user_id=?').get(owner).n, maxCount: 500 } };
  }
  exportData(owner) {
    this.db.exec('BEGIN');
    try {
      const account = this.db.prepare('SELECT id,username,preferences FROM users WHERE id=?').get(owner);
      if (!account) fail(404, '账号不存在');
      const historySize = ['materials', 'generated_resumes'].reduce((sum, table) => sum + this.db.prepare(`SELECT coalesce(sum(length(CAST(snapshot AS BLOB))),0) n FROM ${table} WHERE user_id=?`).get(owner).n, 0);
      const correctionSize = this.db.prepare('SELECT coalesce(sum(length(CAST(before_snapshot || after_snapshot || reason || actor AS BLOB))),0) n FROM submission_corrections WHERE user_id=?').get(owner).n;
      const jdSize = this.db.prepare('SELECT coalesce(sum(length(CAST(jd AS BLOB))),0) n FROM jobs WHERE user_id=?').get(owner).n;
      const schoolSize = this.db.prepare('SELECT coalesce(sum(length(CAST(before_snapshot || after_snapshot AS BLOB))),0) n FROM school_changes WHERE user_id=?').get(owner).n;
      const migrationSize = this.db.prepare('SELECT coalesce(sum(length(CAST(snapshot AS BLOB))),0) n FROM migration_receipts WHERE user_id=?').get(owner).n;
      const questionSize = ['question_drafts','question_history'].reduce((sum, table) => sum + this.db.prepare(`SELECT coalesce(sum(length(CAST(snapshot AS BLOB))),0) n FROM ${table} WHERE user_id=?`).get(owner).n, 0);
      const preparationSize = this.db.prepare('SELECT coalesce(sum(length(CAST(notes AS BLOB))),0) n FROM application_preparation WHERE user_id=?').get(owner).n;
      if (historySize + correctionSize + jdSize + schoolSize + migrationSize + preparationSize + questionSize > 24 * 1024 * 1024) fail(413, '历史内容超过本期导出限制，请使用本机完整备份');
      const rows = (table, columns) => this.db.prepare(`SELECT ${columns} FROM ${table} WHERE user_id=? ORDER BY rowid`).all(owner);
      const data = { format: 'career-queue-personal-export', version: 1, exportedAt: new Date(this.now()).toISOString(),
        account: { id: account.id, username: account.username }, preferences: JSON.parse(account.preferences),
        schoolOpportunities: this.schoolOpportunities(owner), jobs: this.jobs(owner), activeResume: this.activeResume(owner), migrationReceipts: this.migrationReceipts(owner),
        resumeText: rows('resume_text', 'file_id,text,text_hash,pages,parser'),
        channels: rows('application_plans', 'job_id,channel'),
        questionHistory: rows('question_history', 'job_id,revision,basis,snapshot,updated,archived').map(row => ({...row, snapshot:JSON.parse(row.snapshot)})),
        questionDrafts: rows('question_drafts', 'job_id,revision,basis,snapshot,updated').map(row => ({...row, snapshot:JSON.parse(row.snapshot)})),
        preparation: rows('application_preparation', 'job_id,revision,notes,basis,reviewed,updated'),
        schoolLinks: this.schoolLinks(owner),
        schoolHistory: this.schoolHistory(owner), schoolSubmissionSources: this.schoolSubmissionSources(owner),
        materials: rows('materials', 'id,job_id,fingerprint,snapshot,created').map(row => ({ ...row, snapshot: JSON.parse(row.snapshot) })),
        generatedResumes: rows('generated_resumes', 'id,job_id,fingerprint,pdf_id,docx_id,snapshot,created').map(row => ({ ...row, snapshot: JSON.parse(row.snapshot) })),
        submissions: rows('submissions', 'id,job_id,channel,material_id,submitted_date,receipt,created'),
        submissionCorrections: rows('submission_corrections', 'id,job_id,submission_id,revision,request_id,before_snapshot,after_snapshot,reason,actor,created')
          .map(({ before_snapshot, after_snapshot, ...row }) => ({ ...row, before: JSON.parse(before_snapshot), after: JSON.parse(after_snapshot) })),
        files: this.files(owner).map(file => ({ ...file, archivePath: `files/${file.id}.${file.format}`, base64: Buffer.from(this.file(owner, file.id).bytes).toString('base64') })) };
      this.db.exec('COMMIT'); return data;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  generatedResumes(owner, id) {
    this.job(owner, id);
    const context = this.materialContext(owner, id);
    return this.db.prepare('SELECT id,pdf_id pdfId,docx_id docxId,snapshot,created FROM generated_resumes WHERE user_id=? AND job_id=? ORDER BY created DESC,rowid DESC').all(owner, id)
      .map(row => ({ ...row, snapshot: JSON.parse(row.snapshot), stale: JSON.parse(row.snapshot).context.hash !== context.hash }));
  }
  saveGenerated(owner, id, context, result, fingerprint, parentId = null) {
    if (context.hash !== this.materialContext(owner, id).hash) fail(409, '生成期间岗位或简历已变化，未保存材料；请重新准备对照');
    let templateSha = context.resume.fileSha;
    if (parentId) {
      const parent = this.generatedResumes(owner, id).find(row => row.id === parentId);
      if (!parent || parent.stale) fail(409, '编辑来源已变化，未保存材料');
      templateSha = this.file(owner, parent.docxId).sha256;
    }
    const validation = result.validation;
    if (!validation?.passed || validation.pages !== 1 || validation.templateSha256 !== templateSha || validation.pdfSha256 !== hash(result.pdf) || validation.docxSha256 !== hash(result.docx)) fail(422, '生成文件校验无效');
    const existing = this.db.prepare('SELECT id FROM generated_resumes WHERE user_id=? AND job_id=? AND fingerprint=?').get(owner, id, fingerprint);
    if (existing) return this.generatedResumes(owner, id).find(row => row.id === existing.id);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const name = `resume-${id.slice(0, 8)}-${randomUUID().slice(0, 8)}`;
      const pdf = this.saveFile(owner, `${name}.pdf`, result.pdf), docx = this.saveFile(owner, `${name}.docx`, result.docx);
      const versionId = randomUUID(), snapshot = { context, validation, review: result.review, ...(parentId ? { parentId } : {}) };
      this.db.prepare('INSERT INTO generated_resumes VALUES (?,?,?,?,?,?,?,?)').run(versionId, owner, id, fingerprint, pdf.id, docx.id, JSON.stringify(snapshot), this.now());
      this.db.exec('COMMIT');
      return this.generatedResumes(owner, id).find(row => row.id === versionId);
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  materialContext(owner, id) {
    const job = this.job(owner, id), resume = this.activeResume(owner);
    const source = { job: { id: job.id, company: job.company, title: job.title, location: job.location, url: job.url, jd: job.jd },
      resume: resume ? { fileId: resume.fileId, name: resume.name, fileSha: resume.fileSha, textHash: resume.textHash } : null };
    return { ...source, hash: hash(JSON.stringify(source)), ready: Boolean(resume && job.jd.trim()) };
  }
  application(owner, id) {
    const context = this.materialContext(owner, id);
    const channel = this.db.prepare('SELECT channel FROM application_plans WHERE user_id=? AND job_id=?').get(owner, id)?.channel ?? 'unknown';
    const versions = this.db.prepare('SELECT id,snapshot,created FROM materials WHERE user_id=? AND job_id=? ORDER BY created DESC,rowid DESC').all(owner, id)
      .map(row => { const snapshot = JSON.parse(row.snapshot); return { id: row.id, created: row.created, snapshot, stale: snapshot.context.hash !== context.hash }; });
    const corrections = this.db.prepare('SELECT id,submission_id submissionId,revision,request_id requestId,before_snapshot,after_snapshot,reason,actor,created FROM submission_corrections WHERE user_id=? AND job_id=? ORDER BY revision').all(owner, id)
      .map(({ before_snapshot, after_snapshot, ...row }) => ({ ...row, before: JSON.parse(before_snapshot), after: JSON.parse(after_snapshot) }));
    const submissions = this.db.prepare('SELECT id,channel,material_id materialId,submitted_date date,receipt,created FROM submissions WHERE user_id=? AND job_id=? ORDER BY created').all(owner, id)
      .map(row => { const history = corrections.filter(correction => correction.submissionId === row.id); return { ...row, revision: history.at(-1)?.revision ?? 0, corrections: history }; });
    const required = channel === 'both' ? ['employer', 'school'] : channel === 'school-only' ? ['school'] : channel === 'employer' ? ['employer'] : [];
    const complete = required.length > 0 && required.every(value => submissions.some(record => record.channel === value));
    return { context, channel, versions, submissions, required, complete,
      status: channel === 'unknown' ? '待确认申请渠道' : complete ? '已记录提交' : submissions.length ? '还有渠道待处理' : versions.some(version => !version.stale) ? '材料已审阅，待本人提交' : versions.length ? '材料需重新审阅' : '待准备材料' };
  }
  preparation(owner, id) {
    const app = this.application(owner, id);
    const school = this.schoolContext(owner, id);
    const basis = hash(JSON.stringify({ context: app.context.hash, channel: app.channel, school,
      materials: app.versions.map(v => v.id) }));
    const row = this.db.prepare('SELECT revision,notes,basis,reviewed,updated FROM application_preparation WHERE user_id=? AND job_id=?').get(owner, id);
    return { revision: row?.revision ?? 0, notes: row?.notes ?? '', basis,
      reviewed: Boolean(row?.reviewed && row.basis === basis), stale: Boolean(row && row.basis !== basis), updated: row?.updated ?? null };
  }
  savePreparation(owner, id, input) {
    const current = this.preparation(owner, id);
    if (input.revision !== current.revision || input.basis !== current.basis) fail(409, '申请准备或依据已变化；输入保留，请刷新核对后再保存');
    const notes = textField(input.notes, 12000);
    if (typeof input.reviewed !== 'boolean') fail(400, '请核对准备状态');
    this.db.prepare('INSERT INTO application_preparation VALUES (?,?,?,?,?,?,?) ON CONFLICT(job_id) DO UPDATE SET revision=excluded.revision,notes=excluded.notes,basis=excluded.basis,reviewed=excluded.reviewed,updated=excluded.updated')
      .run(id, owner, current.revision + 1, notes, current.basis, Number(input.reviewed), this.now());
    return this.preparation(owner, id);
  }
  questionDraft(owner, id) {
    const basis = this.preparation(owner, id).basis;
    const row = this.db.prepare('SELECT revision,basis,snapshot,updated FROM question_drafts WHERE user_id=? AND job_id=?').get(owner, id);
    return { history: this.db.prepare('SELECT revision,updated,archived FROM question_history WHERE user_id=? AND job_id=? ORDER BY revision DESC').all(owner,id), revision: row?.revision ?? 0, basis, stale: Boolean(row && row.basis !== basis), updated: row?.updated ?? null, draft: row ? JSON.parse(row.snapshot) : null };
  }
  questionHistory(owner, id, revision) {
    this.job(owner,id);
    const row = this.db.prepare('SELECT revision,basis,snapshot,updated,archived FROM question_history WHERE user_id=? AND job_id=? AND revision=?').get(owner,id,revision);
    if (!row) fail(404,'未找到该问题历史');
    return {...row, draft:JSON.parse(row.snapshot), snapshot:undefined};
  }
  saveQuestionDraft(owner, id, input) {
    const current = this.questionDraft(owner, id);
    if (input.revision !== current.revision || input.basis !== current.basis) fail(409, '逐题草稿或依据已变化，请刷新核对；旧答案未改');
    if (current.stale && input.reconfirmed !== true) fail(409, '岗位或简历等依据已变化，请重新核对答案');
    const value = input.draft;
    if (!value || JSON.stringify(value).length > 60000 || !Array.isArray(value.answers) || !Array.isArray(value.form?.questions) || value.answers.length !== value.form.questions.length || value.answers.length > 400) fail(400, '逐题草稿大小或格式不正确');
    const text = (v, n) => textField(v, n);
    const source = text(value.form.source, 500);
    if (!/^https:\/\/boards-api\.greenhouse\.io\/v1\/boards\/[a-z0-9_-]+\/jobs\/\d+\?questions=true$/i.test(source)) fail(400, '问题来源不正确');
    const form = {title:text(value.form.title,10000),source,checkedAt:text(value.form.checkedAt,100),notice:text(value.form.notice,2000),warnings:[],questions:value.form.questions.map(q => {
      if (!q || typeof q.required !== 'boolean' || !Array.isArray(q.fields) || q.fields.length > 20) fail(400, '问题格式不正确');
      return {section:text(q.section ?? '申请问题',100),label:text(q.label,10000),required:q.required,fields:q.fields.map(f => {
        if (!f || !Array.isArray(f.options) || f.options.length > 200) fail(400, '选项格式不正确');
        return {type:text(f.type,100),options:f.options.map(v=>text(v,10000))};
      })};
    })};
    if (!Array.isArray(value.form.warnings) || value.form.warnings.length > 20) fail(400, '来源提示不正确');
    form.warnings = value.form.warnings.map(v=>text(v,2000));
    const answers = value.answers.map(a => { if (!a || typeof a.selected !== 'boolean') fail(400,'答案选择不正确'); return {selected:a.selected,answer:text(a.answer,4000)}; });
    const changed = current.draft && (current.draft.form.source !== form.source || JSON.stringify(current.draft.form.questions) !== JSON.stringify(form.questions));
    if (changed && input.replaceConfirmed !== true) fail(409, '官网问题已变化，请查看对照并确认启用新版本');
    if (changed && answers.some(a => a.selected || a.answer)) fail(400, '新问题版本须从空白答案开始，不自动迁移旧答案');
    this.db.exec('BEGIN');
    try {
      if (changed) this.db.prepare('INSERT INTO question_history SELECT job_id,user_id,revision,basis,snapshot,updated,? FROM question_drafts WHERE user_id=? AND job_id=?').run(this.now(),owner,id);
      this.db.prepare('INSERT INTO question_drafts VALUES (?,?,?,?,?,?) ON CONFLICT(job_id) DO UPDATE SET revision=excluded.revision,basis=excluded.basis,snapshot=excluded.snapshot,updated=excluded.updated')
        .run(id,owner,current.revision+1,current.basis,JSON.stringify({form,answers}),this.now());
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return this.questionDraft(owner,id);
  }
  setApplicationChannel(owner, id, input) {
    this.job(owner, id);
    if (!['unknown', 'employer', 'both', 'school-only'].includes(input.channel)) fail(400, '请选择申请渠道');
    this.db.prepare('INSERT INTO application_plans VALUES (?,?,?) ON CONFLICT(job_id) DO UPDATE SET channel=excluded.channel').run(id, owner, input.channel);
    return this.application(owner, id);
  }
  markPdfViewed(owner, fileId, pages, sessionKey) {
    if (this.file(owner, fileId).format !== 'pdf' || !Number.isInteger(pages) || pages < 1 || pages > 10) fail(422, 'PDF 预览结果无效');
    this.db.prepare('INSERT INTO pdf_reviews VALUES (?,?,?,?,?) ON CONFLICT(file_id) DO UPDATE SET pages=excluded.pages,session_key=excluded.session_key,viewed=excluded.viewed').run(fileId, owner, pages, hash(sessionKey), this.now());
  }
  reviewMaterial(owner, id, input, sessionKey) {
    const context = this.materialContext(owner, id);
    if (!context.ready) fail(409, '请先保存完整 JD 并启用自己的简历');
    if (input.confirmed !== true || input.contextHash !== context.hash) fail(409, '岗位或简历已变化，请刷新材料区并重新审阅');
    const read = (fileId, onePage) => {
      const file = this.file(owner, textField(fileId, 36, true));
      const review = this.db.prepare('SELECT * FROM pdf_reviews WHERE user_id=? AND file_id=?').get(owner, file.id);
      if (file.format !== 'pdf' || !review || review.session_key !== hash(sessionKey) || this.now() - review.viewed > 15 * 60000 || review.viewed > this.now()) fail(409, '请在当前会话重新预览所选 PDF（预览有效期 15 分钟）');
      if (onePage && review.pages !== 1) fail(422, '简历必须保持一页；请修改原稿后重新上传 PDF');
      return { id: file.id, name: file.name, sha256: file.sha256, pages: review.pages };
    };
    const resume = read(input.resumeFileId, true), cover = input.coverFileId ? read(input.coverFileId, false) : null;
    const generatedOwner = this.db.prepare('SELECT job_id FROM generated_resumes WHERE user_id=? AND pdf_id=?').get(owner, resume.id);
    if (generatedOwner && generatedOwner.job_id !== id) fail(409, '这份生成稿属于其他职位，请为当前职位重新生成');
    const generated = this.generatedResumes(owner, id).find(row => row.pdfId === resume.id);
    if (generated?.stale) fail(409, '这份生成稿的简历或 JD 已变化，请重新生成；旧提交记录仍保留');
    const snapshot = { context, resume, cover, ...(generated ? { generation: generated } : {}) }, fingerprint = hash(JSON.stringify(snapshot));
    const existing = this.db.prepare('SELECT id FROM materials WHERE user_id=? AND job_id=? AND fingerprint=?').get(owner, id, fingerprint);
    if (!existing) {
      if (this.db.prepare('SELECT count(*) n FROM materials WHERE user_id=? AND job_id=?').get(owner, id).n >= 50) fail(409, '每个岗位最多保存 50 个材料版本');
      this.db.prepare('INSERT INTO materials VALUES (?,?,?,?,?,?)').run(randomUUID(), owner, id, fingerprint, JSON.stringify(snapshot), this.now());
    }
    return this.application(owner, id);
  }
  recordSubmission(owner, id, input) {
    this.job(owner, id);
    const materialId = textField(input.materialId, 36, true), date = submissionDate(input.date, this.now()), receipt = textField(input.receipt ?? '', 500);
    if (!['employer', 'school'].includes(input.channel)) fail(400, '提交渠道不正确');
    if (input.confirmed !== true || input.attachmentsComplete !== true) fail(400, '请确认本人已实际提交且要求的附件齐全');
    const requestId = input.requestId === undefined ? null : requestIdentifier(input.requestId);
    const fingerprint = hash(JSON.stringify({ channel: input.channel, materialId, date, receipt,
      ...(input.channel === 'school' && input.schoolRevision !== undefined ? { schoolRevision: input.schoolRevision } : {}) }));
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const application = this.application(owner, id);
      const retry = requestId && this.db.prepare('SELECT job_id,request_hash FROM submissions WHERE user_id=? AND request_id=?').get(owner, requestId);
      if (retry) {
        if (retry.job_id !== id || retry.request_hash !== fingerprint) fail(409, '此操作已用于另一份提交内容，请刷新后重试');
        this.db.exec('COMMIT'); return application;
      }
      const existing = application.submissions.find(record => record.channel === input.channel);
      if (existing) {
        if (!requestId && existing.materialId === materialId && existing.date === date && existing.receipt === receipt) { this.db.exec('COMMIT'); return application; }
        fail(409, '此渠道已有提交记录；请使用更正入口，不覆盖历史');
      }
      if (!requestId && application.submissions.some(record => record.materialId === materialId && record.corrections.some(correction => correction.before.channel === input.channel && correction.before.date === date && correction.before.receipt === receipt))) fail(409, '此旧请求对应的记录已更正，请刷新后重新确认当前提交');
      if (input.channel === 'school') this.checkSchoolRevision(owner, id, input.schoolRevision);
      if (!application.required.includes(input.channel)) fail(409, '请先确认此岗位需要的申请渠道');
      const version = application.versions.find(version => version.id === materialId);
      if (!version) fail(404, '未找到此岗位的材料版本');
      if (version.stale && input.staleAcknowledged !== true) fail(409, '材料依据已变化；记录历史提交需明确确认当时使用的旧版本');
      this.db.prepare('INSERT INTO submissions(id,user_id,job_id,channel,material_id,submitted_date,receipt,created,request_id,request_hash) VALUES (?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), owner, id, input.channel, materialId, date, receipt, this.now(), requestId, requestId ? fingerprint : null);
      this.captureSchoolSubmission(owner, id, 'submission');
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return this.application(owner, id);
  }
  correctSubmission(owner, id, submissionId, input) {
    this.job(owner, id);
    if (!this.db.prepare('SELECT id FROM submissions WHERE user_id=? AND job_id=? AND id=?').get(owner, id, submissionId)) fail(404, '未找到此岗位的提交记录');
    const date = submissionDate(input.date, this.now()), receipt = textField(input.receipt ?? '', 500), reason = textField(input.reason, 500, true), requestId = requestIdentifier(input.requestId);
    if (!['employer', 'school'].includes(input.channel)) fail(400, '提交渠道不正确');
    if (!Number.isSafeInteger(input.revision) || input.revision < 0) fail(400, '记录版本不正确，请刷新后重试');
    const after = { channel: input.channel, date, receipt };
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const application = this.application(owner, id), record = application.submissions.find(record => record.id === submissionId);
      const retry = this.db.prepare('SELECT submission_id,revision,after_snapshot,reason FROM submission_corrections WHERE user_id=? AND request_id=?').get(owner, requestId);
      if (retry) {
        if (retry.submission_id !== submissionId || retry.revision !== input.revision + 1 || retry.after_snapshot !== JSON.stringify(after) || retry.reason !== reason) fail(409, '此操作已用于另一份更正内容，请刷新后重试');
        this.db.exec('COMMIT'); return application;
      }
      if (record.revision !== input.revision) fail(409, '这条记录已更正，请刷新后核对最新内容');
      if (after.channel === 'school' && !this.schoolSubmissionSources(owner).some(source => source.submissionId === submissionId)) this.checkSchoolRevision(owner, id, input.schoolRevision);
      if (!application.required.includes(after.channel)) fail(409, '请先确认此岗位需要的申请渠道');
      if (application.submissions.some(other => other.id !== submissionId && other.channel === after.channel)) fail(409, '目标渠道已有提交记录，不能覆盖或合并；请核对两条记录');
      const before = { channel: record.channel, date: record.date, receipt: record.receipt };
      if (JSON.stringify(before) === JSON.stringify(after)) fail(400, '内容没有变化，无需保存更正');
      const actor = this.db.prepare('SELECT username FROM users WHERE id=?').get(owner).username;
      this.db.prepare('INSERT INTO submission_corrections VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), owner, id, submissionId, record.revision + 1, requestId, JSON.stringify(before), JSON.stringify(after), reason, actor, this.now());
      this.db.prepare('UPDATE submissions SET channel=?,submitted_date=?,receipt=? WHERE user_id=? AND job_id=? AND id=?').run(after.channel, after.date, after.receipt, owner, id, submissionId);
      this.captureSchoolSubmission(owner, id, 'channel-correction');
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return this.application(owner, id);
  }
  applications(owner) {
    return this.jobs(owner).flatMap(job => { const app = this.application(owner, job.id); return app.versions.length || app.submissions.length ? [{ jobId: job.id, company: job.company, title: job.title, status: app.status, channel: app.channel, submissions: app.submissions }] : []; });
  }
  catalogue() { const row = this.db.prepare('SELECT payload FROM catalogue WHERE id=1').get(); return row ? JSON.parse(row.payload) : { jobs: [], sources: [], finishedAt: null }; }
  saveCatalogue(result) {
    // A partial/failed source cannot erase its last successful records.
    const old = this.catalogue(), sources = new Map(result.sources.map(source => [source.id, source]));
    const jobs = new Map(old.jobs.filter(job => (job.sources || [job.source]).some(source => sources.get(source.id)?.status !== 'complete')).map(job => [job.id, { ...job, stale: true }]));
    const previous = new Map(old.jobs.map(job => [job.id, job]));
    for (const job of result.jobs) {
      const cached = previous.get(job.id);
      jobs.set(job.id, !job.jd && cached?.jd ? { ...job, jd: cached.jd, stale: true, detailError: '正文暂不可读，保留上次正文，请核实' } : { ...job, stale: false });
    }
    const value = { ...result, jobs: [...jobs.values()] };
    this.db.prepare('INSERT INTO catalogue VALUES (1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(JSON.stringify(value));
    return value;
  }
  saveSuggested(owner, id) {
    const job = this.catalogue().jobs.find(job => job.id === id);
    if (!job) fail(404, '岗位已变化，请刷新建议列表');
    const existing = this.jobs(owner).find(saved => saved.url === job.url);
    return existing ? this.setJobHidden(owner, existing.id, false) : this.saveJob(owner, { ...job, location: job.location.slice(0, 200), notes: '' });
  }
}
