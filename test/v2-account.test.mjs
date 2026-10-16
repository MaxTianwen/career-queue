import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { WorkspaceStore } from '../src/v2/store.mjs';
import { recoverAccount } from '../src/v2/account-recovery.mjs';
const password='Synthetic original password!', next='Synthetic changed password!';
async function fixture(t) {
  const directory=resolve('output/test-runs',`v2-account-${randomUUID()}`), database=resolve(directory,'workspace.sqlite');
  const store=new WorkspaceStore(database);store.db.prepare("UPDATE settings SET value=1 WHERE name='registration_open'").run(); t.after(()=>store.close());
  const a=await store.authenticate({username:'alice',password},true), b=await store.authenticate({username:'bob',password},true);
  return {store,a,b,directory,database};
}
test('v2 local recovery retains role, registration, records and other account sessions',async t=>{
  const f=await fixture(t);
  f.store.db.prepare("UPDATE users SET role='admin' WHERE id=?").run(f.a.user.id);
  f.store.setRegistration(f.a.user.id,false);
  const job=f.store.saveJob(f.a.user.id,{company:'Own employer',title:'Intern',notes:'Keep note'});
  const path=await recoverAccount({...f,username:'alice'}), text=await readFile(path,'utf8'), reset=text.match(/密码：([^\n]+)/)[1];
  assert.equal(f.store.session(f.a.token),null); assert.ok(f.store.session(f.b.token));
  await assert.rejects(f.store.authenticate({username:'alice',password}),{status:401});
  const fresh=await f.store.authenticate({username:'alice',password:reset});
  assert.equal(fresh.user.role,'admin'); assert.equal(f.store.registrationOpen(),false);
  assert.deepEqual(f.store.job(f.a.user.id,job.id),job);
  assert.ok(!f.store.exportData(f.a.user.id).account.password);
  await assert.rejects(recoverAccount({...f,username:'missing'}),/不存在/);
  assert.equal((await readdir(f.directory)).filter(p=>p.startsWith('recovery-')).length,1);
});
test('v2 logout during password derivation cannot commit a password change',async t=>{
  const f=await fixture(t);
  const pending=f.store.changePassword(f.a.token,{currentPassword:password,newPassword:next,confirmPassword:next});
  f.store.logout(f.a.token);
  await assert.rejects(pending,{status:401});
  assert.ok(await f.store.authenticate({username:'alice',password}));
});
test('v2 password reset during pending old-password login cannot revive a session',async t=>{
  const f=await fixture(t), old=f.store.db.prepare('SELECT * FROM users WHERE id=?').get(f.a.user.id);
  const pending=f.store.authenticate({username:'alice',password});
  const different=f.store.db.prepare('SELECT * FROM users WHERE id=?').get(f.b.user.id);
  f.store.replacePassword(old,different.salt,Buffer.from(different.password_hash,'hex'));
  await assert.rejects(pending,{status:401});
  assert.equal(f.store.session(f.a.token),null);
});
test('v2 concurrent password changes cannot overwrite each other',async t=>{
  const f=await fixture(t), input={currentPassword:password,newPassword:next,confirmPassword:next};
  const results=await Promise.allSettled([f.store.changePassword(f.a.token,input),f.store.changePassword(f.a.token,input)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(f.store.session(f.a.token),null);
  assert.ok(await f.store.authenticate({username:'alice',password:next}));
});
