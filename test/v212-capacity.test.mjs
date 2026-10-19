import {workspaceServer} from '../src/v2/server.mjs';
import {scoreFor} from '../src/v2/resume.mjs';
import {once} from 'node:events';
import {resolve} from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {WorkspaceStore} from '../src/v2/store.mjs';

test('invited beta allows 30 members plus operator, rejects member 31 atomically and disabled members retain their seat',async t=>{
 const s=new WorkspaceStore(':memory:');t.after(()=>s.close());const password='Synthetic capacity password 2026!',admin=await s.createAdmin({username:'operator',password});
 for(let n=0;n<29;n++)s.db.prepare("INSERT INTO users(id,username,salt,password_hash,role) VALUES(?,?,?,?,'member')").run(randomUUID(),'fixture'+n,'synthetic','synthetic');
 const invite=name=>s.security.issue(admin.id,{username:name,confirmed:true,requestId:randomUUID()});
 const last=invite('lastmember'),overflow=invite('overflow');const account=await s.authenticate({username:'lastmember',password,invitation:last.code},true);
 assert.equal(account.user.role,'member');assert.equal(s.db.prepare("SELECT count(*) n FROM users WHERE role='member'").get().n,30);assert.equal(s.db.prepare('SELECT count(*) n FROM users').get().n,31);
 await assert.rejects(s.authenticate({username:'overflow',password,invitation:overflow.code},true),{status:409});assert.equal(s.security.invitation(overflow.code,'overflow').used_by,null);assert.equal(s.db.prepare("SELECT count(*) n FROM users WHERE username='overflow'").get().n,0);
 s.security.status(admin.id,account.user.id,{confirmed:true,disabled:true,revision:0});await assert.rejects(s.authenticate({username:'overflow',password,invitation:overflow.code},true),{status:409});assert.equal(s.registrationOpen(),false);
});

test('job list reads one resume per request and preserves independent account scoring',async t=>{
 const database=resolve('output/test-runs','score-request-'+randomUUID(),'db.sqlite'),s=new WorkspaceStore(database);t.after(()=>s.close());const password='Synthetic score password 2026!',admin=await s.createAdmin({username:'operator',password}),users=[];
 for(const [username,text] of [['alice','Python software development projects, testing and automation.'],['bob','SQL data analysis projects, reports and database design.']]){
  const invite=s.security.issue(admin.id,{username,confirmed:true,requestId:randomUUID()}),auth=await s.authenticate({username,password,invitation:invite.code},true),file=s.saveFile(auth.user.id,'resume.pdf',Buffer.from('%PDF-1.7 '+text));const parsed=s.saveParsed(auth.user.id,file.id,{text,parser:'fixture'});s.activateResume(auth.user.id,{...parsed,confirmed:true});for(let n=0;n<5;n++)s.saveJob(auth.user.id,{company:'Synthetic',title:'Software Intern '+n,jd:'Python software development and SQL required.'});users.push({auth,resume:s.activeResume(auth.user.id)});
 }
 const server=workspaceServer({legacyRegistration:true, /* Existing pre-email HTTP contract fixture. */database,online:async()=>false});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));
 const original=WorkspaceStore.prototype.activeResume;let reads=0;WorkspaceStore.prototype.activeResume=function(...args){reads++;return original.apply(this,args);};t.after(()=>{WorkspaceStore.prototype.activeResume=original;});
 for(const {auth,resume} of users){reads=0;const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/jobs',{headers:{Cookie:'cq_v2_session='+auth.token,'X-CQ-CSRF':auth.csrf}});assert.equal(response.status,200);const rows=await response.json();assert.equal(reads,1);assert.equal(rows.length,5);for(const row of rows){const {selection,...score}=row.match;assert.deepEqual(score,scoreFor(row,resume));assert.equal(selection.file.fileId,resume.fileId);assert.equal(selection.mode,'legacy');}}
});
