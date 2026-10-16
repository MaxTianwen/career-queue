import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {credentials, key, fail} from './store.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const generic = {ok:true, message:'若信息符合条件，邮件将发送到该邮箱。请检查垃圾箱；未收到可在60秒后重试。'};
const invalid = () => fail(400, '验证信息无效或已过期，请重新申请邮件；申请超过24小时请重新注册；若已完成验证，请返回登录。');
export function emailAddress(value) {
  if (typeof value !== 'string') fail(400, '请填写有效邮箱');
  const email = value.trim().toLowerCase();
  // A conservative ASCII mailbox policy; do not collapse dots or plus-address aliases.
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(email) || email.startsWith('.') || email.includes('..') || email.includes('.@')) fail(400, '请填写有效邮箱');
  return email;
}

// Explicitly injected server-side mail adapter. No SMTP credentials, delivery logs or real adapter here.
export class EmailAccounts {
  constructor(store, transport) { this.store=store; this.db=store.db; this.transport=transport; this.active=new Set(); this.closed=false; }
  get ready() { return typeof this.transport?.send === 'function' && !this.closed; }
  transaction(run) { this.db.exec('BEGIN IMMEDIATE'); try { const value=run(); this.db.exec('COMMIT'); return value; } catch(error) { this.db.exec('ROLLBACK'); throw error; } }
  cleanup() {
    this.db.prepare('DELETE FROM account_email_tokens WHERE expires<=?').run(this.store.now());
    this.db.prepare("DELETE FROM account_email_tokens WHERE purpose='verify' AND subject IN (SELECT id FROM pending_signups WHERE expires<=?)").run(this.store.now());
    this.db.prepare('DELETE FROM pending_signups WHERE expires<=?').run(this.store.now());
  }
  capacity() { if (this.db.prepare("SELECT count(*) n FROM users WHERE role='member'").get().n>=30) fail(409,'试用名额已满（最多30个普通账号）；已有账号请返回登录，或稍后再试。'); }
  requestBudget(email, source, username='') {
    this.store.security.reserve([['mail-address:'+email,1,60000],['mail-address-window:'+email,6,900000],['mail-source:'+source,30,900000],['mail-global',100,900000],...(username?[['mail-name:'+username,6,900000]]:[])]);
    if (!this.ready) fail(503,'邮箱服务尚未接入，暂不能申请邮件；已有账号仍可登录。');
  }
  token(purpose, subject, revision=null) {
    const code=randomBytes(32).toString('hex'), expires=this.store.now()+(purpose==='verify'?30:15)*60000;
    this.db.prepare('DELETE FROM account_email_tokens WHERE purpose=? AND subject=?').run(purpose,subject);
    this.db.prepare('INSERT INTO account_email_tokens VALUES(?,?,?,?,?)').run(digest(code),purpose,subject,expires,revision);
    return {code,expires,purpose};
  }
  dispatch(to, message) {
    // Do not expose provider occupancy via HTTP: that would reveal whether another address exists.
    if(this.active.size>=2){this.db.prepare('DELETE FROM account_email_tokens WHERE token_hash=?').run(digest(message.code));this.store.security.event('mail','delivery-unconfirmed',message.purpose);return;}
    const controller=new AbortController(); this.active.add(controller);let failed=false;
    const revoke=()=>{if(failed)return;failed=true;if(!this.closed){this.db.prepare('DELETE FROM account_email_tokens WHERE token_hash=?').run(digest(message.code));this.store.security.event('mail','delivery-unconfirmed',message.purpose);}};
    const timer=setTimeout(()=>{controller.abort();revoke();},10000);timer.unref();
    // Delivery is deliberately outside the HTTP response path: no account-dependent provider timing/status.
    Promise.resolve().then(()=>this.transport.send({to,...message,signal:controller.signal})).catch(()=>{revoke();}).finally(()=>{clearTimeout(timer);this.active.delete(controller);});
  }
  close() { this.closed=true;for(const controller of this.active)controller.abort(); }
  invitation(id, username) {
    if(!id)return null;
    const invite=this.db.prepare("SELECT i.* FROM account_invitations i JOIN users u ON u.id=i.created_by WHERE i.id=? AND i.username=? AND i.revoked IS NULL AND i.used_by IS NULL AND i.expires>? AND u.role='admin' AND u.disabled_at IS NULL").get(id,username,this.store.now());
    if(!invite)fail(403,'邀请已失效，请联系邀请人或等待开放注册');return invite;
  }
  requestVerification(input, source, resend=false) {
    const email=emailAddress(input.email), {username}=credentials({username:input.username,password:'validation-only-password'});
    this.requestBudget(email,source,username);
    let mail;
    this.transaction(()=>{
      this.cleanup();this.capacity();
      const pending=this.db.prepare('SELECT * FROM pending_signups WHERE username=? AND email=?').get(username,email);
      const invite=pending?this.invitation(pending.invitation_id,username):input.invitation?this.store.security.invitation(input.invitation,username):null;
      if(!invite&&!this.store.registrationOpen())fail(403,'当前已关闭注册，已有账号仍可登录');
      if(this.db.prepare('SELECT 1 FROM users WHERE username=?').get(username)||this.db.prepare('SELECT 1 FROM verified_emails WHERE email=?').get(email))return;
      if(!pending&&(resend||this.db.prepare('SELECT 1 FROM pending_signups WHERE username=? OR email=?').get(username,email)))return;
      if(!pending&&this.db.prepare('SELECT count(*) n FROM pending_signups').get().n>=100)return;
      const id=pending?.id??randomUUID();
      if(!pending)this.db.prepare('INSERT INTO pending_signups VALUES(?,?,?,?,?)').run(id,username,email,this.store.now()+86400000,invite?.id??null);
      mail={...this.token('verify',id),username};
    });
    if(mail)this.dispatch(email,mail);
    return {...generic};
  }
  lookup(code,purpose) {
    if(typeof code!=='string'||!/^[a-f0-9]{64}$/.test(code))invalid();
    const token=this.db.prepare('SELECT * FROM account_email_tokens WHERE token_hash=? AND purpose=? AND expires>?').get(digest(code),purpose,this.store.now());
    if(!token)invalid();return token;
  }
  async complete(input,purpose,source) {
    this.store.security.reserve([['mail-consume-source:'+source,40,900000],['mail-consume-global',200,900000]]);
    const {password}=credentials({username:'verified',password:input.password});
    if(password!==input.confirmPassword)fail(400,'两次密码不一致');
    // Password work is bounded and done before token lookup, avoiding an expensive valid-token oracle.
    this.store.reserveAuth('mail-token:'+digest(String(input.code)).slice(0,24),source);
    this.store.authBusy++;
    try {
      const salt=randomBytes(16).toString('hex'),derived=await key(password,salt);
      return this.transaction(()=>{
        this.cleanup();const token=this.lookup(input.code,purpose);
        if(purpose==='verify') {
          const pending=this.db.prepare('SELECT * FROM pending_signups WHERE id=? AND expires>?').get(token.subject,this.store.now());if(!pending)invalid();
          const invite=this.invitation(pending.invitation_id,pending.username);
          if(!invite&&!this.store.registrationOpen())fail(403,'当前已关闭注册，请稍后再试');
          this.capacity();
          if(this.db.prepare('SELECT 1 FROM users WHERE username=?').get(pending.username)||this.db.prepare('SELECT 1 FROM verified_emails WHERE email=?').get(pending.email))invalid();
          const id=randomUUID();this.db.prepare("INSERT INTO users(id,username,salt,password_hash,role) VALUES(?,?,?,?,'member')").run(id,pending.username,salt,derived.toString('hex'));
          this.db.prepare('INSERT INTO verified_emails VALUES(?,?,?)').run(id,pending.email,this.store.now());
          if(invite)this.store.security.consume(invite,id);
          this.db.prepare('DELETE FROM pending_signups WHERE id=?').run(pending.id);
          this.store.security.event(id,'email-verified',id);
        } else {
          const user=this.db.prepare("SELECT u.* FROM users u JOIN verified_emails e ON e.user_id=u.id WHERE u.id=? AND u.role='member' AND u.disabled_at IS NULL AND u.auth_revision=?").get(token.subject,token.auth_revision);if(!user)invalid();
          this.db.prepare('UPDATE users SET salt=?,password_hash=?,auth_revision=auth_revision+1 WHERE id=?').run(salt,derived.toString('hex'),user.id);
          this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
          this.db.prepare('DELETE FROM pdf_reviews WHERE user_id=?').run(user.id);
          this.store.security.event(user.id,'email-password-reset',user.id);
        }
        this.db.prepare('DELETE FROM account_email_tokens WHERE subject=?').run(token.subject);
        return {ok:true,message:purpose==='verify'?'邮箱已验证，账号已创建。请用刚设置的密码登录。':'密码已重置，所有旧会话已失效。请重新登录。'};
      });
    } finally {this.store.authBusy--;}
  }
  requestReset(input,source) {
    const email=emailAddress(input.email);this.requestBudget(email,source);
    let mail;
    this.transaction(()=>{this.cleanup();const user=this.db.prepare("SELECT u.id,u.username,u.auth_revision FROM users u JOIN verified_emails e ON e.user_id=u.id WHERE e.email=? AND u.role='member' AND u.disabled_at IS NULL").get(email);if(user)mail={...this.token('reset',user.id,user.auth_revision),username:user.username};});
    if(mail)this.dispatch(email,mail);
    return {...generic};
  }
}
