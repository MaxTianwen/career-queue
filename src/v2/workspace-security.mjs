import { createHash, randomBytes, randomUUID } from 'node:crypto';
const digest = value => createHash('sha256').update(value).digest('hex');
const reject = (status, message, retryAfter) => {
  throw Object.assign(new Error(message), { status, ...(retryAfter ? { retryAfter } : {}) });
};
const username = value => {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9_.-]{2,39}$/i.test(value))
    reject(400, '账号需为 3–40 位英文、数字、点、横线或下划线');
  return value.toLowerCase();
};

// Server-owned identity only. Never store invitation plaintext or client IP addresses.
export class WorkspaceSecurity {
  constructor(store) {
    this.store = store;
    this.db = store.db;
    this.now = () => store.now();
    const columns = this.db.prepare('PRAGMA table_info(users)').all();
    if (!columns.some(c => c.name === 'disabled_at')) this.db.exec('ALTER TABLE users ADD COLUMN disabled_at INTEGER');
    if (!columns.some(c => c.name === 'auth_revision'))
      this.db.exec('ALTER TABLE users ADD COLUMN auth_revision INTEGER NOT NULL DEFAULT 0');
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS account_invitations(id TEXT PRIMARY KEY,token_hash TEXT UNIQUE NOT NULL,username TEXT NOT NULL,created_by TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,revoked INTEGER,used_by TEXT,request_id TEXT NOT NULL UNIQUE);
   CREATE TABLE IF NOT EXISTS security_events(id TEXT PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,target TEXT NOT NULL,created INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS security_limits(bucket TEXT NOT NULL,at INTEGER NOT NULL);
   CREATE INDEX IF NOT EXISTS security_limits_bucket ON security_limits(bucket,at);
   CREATE TABLE IF NOT EXISTS pending_signups(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,email TEXT UNIQUE NOT NULL,expires INTEGER NOT NULL,invitation_id TEXT);
   CREATE TABLE IF NOT EXISTS verified_emails(user_id TEXT PRIMARY KEY REFERENCES users(id),email TEXT UNIQUE NOT NULL,verified INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS account_email_tokens(token_hash TEXT PRIMARY KEY,purpose TEXT NOT NULL CHECK(purpose IN ('verify','reset')),subject TEXT NOT NULL,expires INTEGER NOT NULL,auth_revision INTEGER);`);
  }
  admin(owner) {
    if (!this.db.prepare("SELECT 1 FROM users WHERE id=? AND role='admin' AND disabled_at IS NULL").get(owner))
      reject(403, '仅管理员可管理账号与邀请');
  }
  event(actor, action, target) {
    this.db
      .prepare('INSERT INTO security_events VALUES(?,?,?,?,?)')
      .run(randomUUID(), actor, action, target, this.now());
  }
  reserve(limits) {
    const now = this.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM security_limits WHERE at<=?').run(now - 900000);
      for (const [name, max, window] of limits) {
        const row = this.db
          .prepare('SELECT count(*) n,min(at) first FROM security_limits WHERE bucket=? AND at>?')
          .get(digest(name), now - window);
        if (row.n >= max)
          reject(429, '请求过多，请稍后重试', Math.max(1, Math.ceil((row.first + window - now) / 1000)));
      }
      for (const [name] of limits) this.db.prepare('INSERT INTO security_limits VALUES(?,?)').run(digest(name), now);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  auth(name, source) {
    this.reserve([
      [
        'auth-account:' +
          String(name || '')
            .trim()
            .toLowerCase()
            .slice(0, 40),
        20,
        900000
      ],
      ['auth-source:' + source, 100, 900000],
      ['auth-global', 400, 900000]
    ]);
  }
  resource(owner, kind) {
    const limits = { upload: 30, parse: 30, preview: 120, generation: 30, export: 10, refresh: 20, admin: 30 };
    this.reserve([
      ['resource:' + kind + ':' + owner, limits[kind], 300000],
      ['resource-global:' + kind, limits[kind] * 10, 300000]
    ]);
  }
  invitations(owner) {
    this.admin(owner);
    return this.db
      .prepare(
        'SELECT id,username,created_by createdBy,created,expires,revoked,used_by usedBy FROM account_invitations ORDER BY created DESC,rowid DESC LIMIT 100'
      )
      .all();
  }
  issue(owner, input) {
    this.admin(owner);
    if (input.confirmed !== true) reject(400, '请确认创建邀请');
    const name = username(input.username);
    if (!/^[a-f0-9-]{36}$/.test(input.requestId || '')) reject(400, '请刷新后重试');
    if (this.db.prepare('SELECT 1 FROM users WHERE username=?').get(name)) reject(409, '账号已存在，请使用已有账号');
    if (this.db.prepare('SELECT 1 FROM account_invitations WHERE request_id=?').get(input.requestId))
      reject(409, '此邀请请求已处理；邀请码仅显示一次，如未保存请撤销后重新创建');
    if (
      this.db
        .prepare('SELECT count(*) n FROM account_invitations WHERE revoked IS NULL AND used_by IS NULL AND expires>?')
        .get(this.now()).n >= 20
    )
      reject(409, '待使用邀请已达20个，请先撤销旧邀请');
    const id = randomUUID(),
      code = randomBytes(32).toString('hex'),
      created = this.now(),
      expires = created + 86400000;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare('INSERT INTO account_invitations VALUES(?,?,?,?,?,?,NULL,NULL,?)')
        .run(id, digest(code), name, owner, created, expires, input.requestId);
      this.event(owner, 'invite-created', id);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return { id, username: name, code, expires };
  }
  invitation(code, name) {
    if (!/^[a-f0-9]{64}$/.test(code || '')) reject(403, '邀请无效、已过期或不匹配此账号');
    const row = this.db
      .prepare(
        "SELECT i.* FROM account_invitations i JOIN users u ON u.id=i.created_by WHERE i.token_hash=? AND i.username=? AND i.revoked IS NULL AND i.used_by IS NULL AND i.expires>? AND u.role='admin' AND u.disabled_at IS NULL"
      )
      .get(digest(code), name, this.now());
    if (!row) reject(403, '邀请无效、已过期或不匹配此账号');
    return row;
  }
  consume(invite, user) {
    const result = this.db
      .prepare(
        'UPDATE account_invitations SET used_by=? WHERE id=? AND used_by IS NULL AND revoked IS NULL AND expires>?'
      )
      .run(user, invite.id, this.now());
    if (!result.changes) reject(409, '邀请已失效');
    this.event(user, 'invite-redeemed', invite.id);
  }
  revoke(owner, id, input) {
    this.admin(owner);
    if (input.confirmed !== true) reject(400, '请确认撤销邀请');
    const row = this.db.prepare('SELECT id,used_by,revoked FROM account_invitations WHERE id=?').get(id);
    if (!row) reject(404, '邀请不存在');
    if (row.used_by) reject(409, '邀请已使用；如需停止访问请停用账号');
    if (row.revoked !== null) return { ok: true };
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('UPDATE account_invitations SET revoked=? WHERE id=?').run(this.now(), id);
      this.event(owner, 'invite-revoked', id);
      this.db.exec('COMMIT');
      return { ok: true };
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  users(owner) {
    this.admin(owner);
    return this.db
      .prepare('SELECT id,username,role,disabled_at disabledAt,auth_revision revision FROM users ORDER BY username')
      .all();
  }
  status(owner, id, input) {
    this.admin(owner);
    if (input.confirmed !== true || typeof input.disabled !== 'boolean' || !Number.isInteger(input.revision))
      reject(400, '请核对当前账号状态并确认');
    const user = this.db.prepare('SELECT id,role,auth_revision FROM users WHERE id=?').get(id);
    if (!user) reject(404, '账号不存在');
    if (id === owner || user.role !== 'member') reject(403, '此入口仅管理普通账号，不能停用自己或管理员');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const changed = this.db
        .prepare('UPDATE users SET disabled_at=?,auth_revision=auth_revision+1 WHERE id=? AND auth_revision=?')
        .run(input.disabled ? this.now() : null, id, input.revision);
      if (!changed.changes) reject(409, '账号状态已变化，请刷新后核对');
      this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      this.db.prepare('DELETE FROM pdf_reviews WHERE user_id=?').run(id);
      this.db.prepare('DELETE FROM account_email_tokens WHERE subject=?').run(id);
      this.event(owner, input.disabled ? 'account-disabled' : 'account-enabled', id);
      this.db.exec('COMMIT');
      return this.users(owner).find(u => u.id === id);
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  events(owner) {
    this.admin(owner);
    return this.db
      .prepare('SELECT actor,action,target,created FROM security_events ORDER BY created DESC,rowid DESC LIMIT 100')
      .all();
  }
}
