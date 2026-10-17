import {mkdir} from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {once} from 'node:events';
import {request} from 'node:http';
import {WorkspaceStore} from '../src/v2/store.mjs';
import {workspaceServer} from '../src/v2/server.mjs';
import {backupWorkspace,restoreWorkspace} from '../src/v2/backup.mjs';
const password='Synthetic security password 2026!';
async function fixture(t,options={}){
 const database=resolve('output/test-runs','security-'+randomUUID(),'db.sqlite');let time=Date.now();const s=new WorkspaceStore(database,{now:()=>time});t.after(()=>s.close());
 const admin=await s.createAdmin({username:'operator',password}),root=await s.authenticate({username:'operator',password});
 const invite=name=>s.security.issue(admin.id,{username:name,confirmed:true,requestId:randomUUID()});
 const member=async name=>s.authenticate({username:name,password,invitation:invite(name).code},true);
 const server=workspaceServer({legacyRegistration:true, /* Existing pre-email HTTP contract fixture. */database,now:()=>time,online:async()=>false,discover:async()=>({jobs:[],sources:[]}),archive:async data=>Buffer.from(JSON.stringify(data)),...options});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));
 async function call(path,{auth,method='GET',value,headers={}}={}){const origin='http://127.0.0.1:'+server.address().port;return new Promise((done,reject)=>{const req=request(origin+path,{method,headers:{Origin:origin,...(auth?{Cookie:'cq_v2_session='+auth.token,'X-CQ-CSRF':auth.csrf}:{}),...(value!==undefined?{'Content-Type':'application/json'}:{}),...headers}},res=>{const parts=[];res.on('data',x=>parts.push(x));res.on('end',()=>{const text=Buffer.concat(parts).toString();done({status:res.statusCode,headers:res.headers,text,data:res.headers['content-type']?.includes('json')?JSON.parse(text):null})});});req.on('error',reject);req.end(value===undefined?undefined:JSON.stringify(value));});}
 return {s,root,admin,invite,member,call,database,advance:n=>time+=n};
}
test('new workspaces deny open registration; legacy setting survives migration without altering private data',async t=>{
 const f=await fixture(t);assert.equal(f.s.registrationOpen(),false);assert.equal((await f.call('/api/register',{method:'POST',value:{username:'uninvited',password}})).status,403);
 f.s.setRegistration(f.admin.id,true);const a=await f.s.authenticate({username:'legacy',password,role:'admin'},true);const job=f.s.saveJob(a.user.id,{company:'Private',title:'Intern'});const again=new WorkspaceStore(f.database);try{assert.equal(again.registrationOpen(),true);assert.equal(again.job(a.user.id,job.id).title,'Intern');assert.equal(again.session(a.token).role,'member');}finally{again.close();}
});
test('invites are username-bound, secret-hashed, confirmed, single-use, non-escalating and replay safe',async t=>{
 const f=await fixture(t),requestId=randomUUID(),input={username:'alice',confirmed:true,requestId};
 assert.throws(()=>f.s.security.issue(f.admin.id,{...input,confirmed:false}),{status:400});const i=f.s.security.issue(f.admin.id,input);
 assert.throws(()=>f.s.security.issue(f.admin.id,input),{status:409});assert.ok(!JSON.stringify(f.s.security.invitations(f.admin.id)).includes(i.code));assert.ok(!JSON.stringify(f.s.db.prepare('SELECT * FROM account_invitations').all()).includes(i.code));
 await assert.rejects(f.s.authenticate({username:'bob',password,invitation:i.code},true),{status:403});
 const results=await Promise.allSettled([1,2].map(()=>f.s.authenticate({username:'alice',password,invitation:i.code,role:'admin'},true)));assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.find(x=>x.status==='fulfilled').value.user.role,'member');
 await assert.rejects(f.s.authenticate({username:'alice',password,invitation:i.code},true),{status:403});assert.equal(f.s.db.prepare("SELECT count(*) n FROM users WHERE username='alice'").get().n,1);
 assert.ok(!JSON.stringify(f.s.security.events(f.admin.id)).includes(i.code));
});
test('expired/revoked invitations reject redemption, even when revoked during password derivation',async t=>{
 const f=await fixture(t),i=f.invite('expired');f.advance(86400001);await assert.rejects(f.s.authenticate({username:'expired',password,invitation:i.code},true),{status:403});
 const j=f.invite('revoked'),pending=f.s.authenticate({username:'revoked',password,invitation:j.code},true);f.s.security.revoke(f.admin.id,j.id,{confirmed:true});await assert.rejects(pending,{status:403});assert.equal(f.s.db.prepare("SELECT count(*) n FROM users WHERE username='revoked'").get().n,0);
});
test('disable revokes sessions and in-flight login; enable preserves data without reviving old sessions; revision rejects repeats',async t=>{
 const f=await fixture(t),a=await f.member('alice'),b=await f.member('bob'),job=f.s.saveJob(a.user.id,{company:'Retain',title:'Intern'}),file=f.s.saveFile(a.user.id,'keep.pdf',Buffer.from('%PDF-1.7 keep'));
 assert.throws(()=>f.s.security.status(b.user.id,a.user.id,{disabled:true,revision:0,confirmed:true}),{status:403});assert.throws(()=>f.s.security.status(f.admin.id,f.admin.id,{disabled:true,revision:0,confirmed:true}),{status:403});
 const pending=f.s.authenticate({username:'alice',password});f.s.security.status(f.admin.id,a.user.id,{disabled:true,revision:0,confirmed:true});
 assert.equal(f.s.session(a.token),null);assert.ok(f.s.session(b.token));assert.equal((await f.call('/api/jobs',{auth:a})).status,401);await assert.rejects(pending,{status:401});
 assert.throws(()=>f.s.security.status(f.admin.id,a.user.id,{disabled:false,revision:0,confirmed:true}),{status:409});
 f.s.security.status(f.admin.id,a.user.id,{disabled:false,revision:1,confirmed:true});assert.equal(f.s.session(a.token),null);assert.ok((await f.s.authenticate({username:'alice',password})).token);assert.equal(f.s.job(a.user.id,job.id).title,'Intern');assert.equal(f.s.file(a.user.id,file.id).sha256,file.sha256);
});
test('disable then re-enable during derivation cannot mint a session from a stale login snapshot',async t=>{
 const f=await fixture(t),a=await f.member('alice'),pending=f.s.authenticate({username:'alice',password});f.s.security.status(f.admin.id,a.user.id,{disabled:true,confirmed:true,revision:0});f.s.security.status(f.admin.id,a.user.id,{disabled:false,confirmed:true,revision:1});await assert.rejects(pending,{status:401});
});
test('admin endpoints enforce role/CSRF and never expose password/session/invite hashes',async t=>{
 const f=await fixture(t),a=await f.member('alice');
 for(const path of ['/api/admin/accounts','/api/admin/invitations','/api/admin/security-events']){assert.equal((await f.call(path)).status,401);assert.equal((await f.call(path,{auth:a})).status,403);const response=await f.call(path,{auth:f.root});assert.equal(response.status,200);assert.doesNotMatch(response.text,/password|salt|token_hash|csrf/);}
 assert.equal((await f.call('/api/admin/invitations',{method:'POST',auth:f.root,value:{username:'newuser',confirmed:true,requestId:randomUUID()},headers:{'X-CQ-CSRF':'wrong'}})).status,403);
 assert.equal((await f.call('/api/admin/accounts/'+a.user.id+'/status',{method:'PUT',auth:a,value:{disabled:true,confirmed:true,revision:0}})).status,403);
});
test('account-scoped limits survive restart and one account cannot exhaust another; forwarded IP cannot bypass real source budget',async t=>{
 const f=await fixture(t);for(let i=0;i<20;i++)assert.equal((await f.call('/api/login',{method:'POST',value:{username:'no',password:''},headers:{'X-Forwarded-For':'test-'+i}})).status,400);
 const blocked=await f.call('/api/login',{method:'POST',value:{username:'no',password:''}});assert.equal(blocked.status,429);assert.ok(Number(blocked.headers['retry-after'])>0);
 const reopened=new WorkspaceStore(f.database);try{assert.throws(()=>reopened.reserveAuth('no','127.0.0.1'),{status:429});}finally{reopened.close();}
 assert.equal((await f.call('/api/login',{method:'POST',value:{username:'operator',password}})).status,200);
 for(let i=0;i<79;i++)await f.call('/api/login',{method:'POST',value:{username:'unknown'+i,password:''},headers:{'X-Forwarded-For':'192.0.2.'+i}});
 assert.equal((await f.call('/api/login',{method:'POST',value:{username:'another',password:''},headers:{'X-Forwarded-For':'203.0.113.2'}})).status,429);
 f.advance(900001);assert.equal((await f.call('/api/login',{method:'POST',value:{username:'operator',password}})).status,200);
});
test('resource limits are per account and kind; repeated refresh requests cannot monopolize the shared runner',async t=>{
 const f=await fixture(t),a=await f.member('alice'),b=await f.member('bob');
 for(let i=0;i<20;i++)await f.call('/api/recommendations/update',{auth:a,method:'POST',value:{trigger:'open'}});
 assert.equal((await f.call('/api/recommendations/update',{auth:a,method:'POST',value:{trigger:'open'}})).status,429);
 assert.equal((await f.call('/api/recommendations/update',{auth:b,method:'POST',value:{trigger:'open'}})).status,202);
 assert.equal((await f.call('/api/jobs',{auth:a})).status,200);assert.equal((await f.call('/api/data/export',{auth:a,method:'POST',value:{}})).status,200);
});
test('owner matrix denies member/admin IDOR, file history, preview and resume mutation; lists, school, export and catalogue remain private',async t=>{
 const f=await fixture(t),a=await f.member('alice'),b=await f.member('bob'),marker='PRIVATE_SENTINEL_ALICE';
 const j=f.s.saveJob(a.user.id,{company:marker,title:'Software Intern 2027',jd:'Private school JD '+marker}),file=f.s.saveFile(a.user.id,'private.pdf',Buffer.from('%PDF-1.7 '+marker));
 f.s.syncSchoolOpportunities(a.user.id,'|Term|ID|Job Title|Organization|Location|\n|---|---|---|---|---|\n|Summer 2027|900123|Software Intern|'+marker+'|Toronto|');
 const before=JSON.stringify(f.s.exportData(a.user.id));
 for(const auth of [b,f.root]){
  for(const suffix of ['','/application','/preparation','/question-draft','/generation','/school-context'])assert.equal((await f.call('/api/jobs/'+j.id+suffix,{auth})).status,404,suffix);
  for(const [method,suffix,value] of [['PUT','/visibility',{hidden:true}],['PUT','/return',{}],['PUT','',{company:'forged',title:'x'}],['PUT','/channel',{channel:'employer'}],['POST','/availability',{}],['POST','/generation-draft',{}]])assert.equal((await f.call('/api/jobs/'+j.id+suffix,{auth,method,value})).status,404,suffix);
  for(const suffix of ['','/parse','/preview','/history-preview','/trash','/restore'])assert.equal((await f.call('/api/files/'+file.id+suffix,{auth,method:suffix?'POST':'GET',value:suffix?{confirmed:true}:undefined})).status,404,suffix);
  assert.equal((await f.call('/api/resume/activate',{auth,method:'POST',value:{fileId:file.id,confirmed:true}})).status,404);
  for(const path of ['/api/jobs','/api/files','/api/files/trash','/api/resume','/api/applications','/api/withdrawn-applications','/api/school','/api/school/opportunities','/api/school/history','/api/recommendations','/api/eligibility/exclusions','/api/data/migrations','/api/data/usage']){const response=await f.call(path,{auth});assert.equal(response.status,200,path);assert.ok(!response.text.includes(marker),path);}
  const exported=await f.call('/api/data/export',{auth,method:'POST',value:{}});assert.equal(exported.status,200);assert.ok(!exported.text.includes(marker));assert.doesNotMatch(exported.text,/token_hash|password_hash|account_invitations/);
 }
 assert.equal(JSON.stringify(f.s.exportData(a.user.id)).replace(/"exportedAt":"[^"]+"/,''),before.replace(/"exportedAt":"[^"]+"/,''));assert.ok(!JSON.stringify(f.s.catalogue()).includes(marker));
});
test('disable during private export prevents returning bytes; backup restore revokes invitations and retains disabled state',async t=>{
 let release;const f=await fixture(t,{archive:()=>new Promise(r=>release=r)}),a=await f.member('alice'),invite=f.invite('pending');
 const pending=f.call('/api/data/export',{auth:a,method:'POST',value:{}});while(!release)await new Promise(r=>setTimeout(r,1));f.s.security.status(f.admin.id,a.user.id,{disabled:true,revision:0,confirmed:true});release(Buffer.from('PRIVATE_BYTES'));const response=await pending;assert.equal(response.status,401);assert.ok(!response.text.includes('PRIVATE_BYTES'));
 const folder=resolve('output/test-runs','security-backup-'+randomUUID());await mkdir(folder,{recursive:true});await backupWorkspace(f.database,folder+'/backup');await restoreWorkspace(folder+'/backup',folder+'/restored');const restored=new WorkspaceStore(folder+'/restored/workspaces.sqlite');try{assert.throws(()=>restored.security.invitation(invite.code,'pending'),{status:403});assert.equal(restored.session(a.token),null);assert.ok(restored.security.users(f.admin.id).find(u=>u.id===a.user.id).disabledAt);assert.equal(restored.registrationOpen(),false);}finally{restored.close();}
});

test('disabling an account invalidates its browser pairing code while retaining private answers',async t=>{
 const f=await fixture(t),a=await f.member('alice'),url='https://job-boards.greenhouse.io/test/jobs/123',j=f.s.saveJob(a.user.id,{company:'Synthetic',title:'Intern',url});
 const draft={form:{title:'Synthetic',source:'https://boards-api.greenhouse.io/v1/boards/test/jobs/123?questions=true',checkedAt:new Date().toISOString(),notice:'Local',warnings:[],questions:[{section:'申请问题',label:'First Name',required:true,fields:[{type:'input_text',options:[]}]}]},answers:[{selected:true,answer:'Synthetic'}]};
 const state=f.s.saveQuestionDraft(a.user.id,j.id,{...f.s.questionDraft(a.user.id,j.id),draft});
 const grant=await f.call('/api/jobs/'+j.id+'/browser-fill-code',{auth:a,method:'POST',value:{revision:state.revision,basis:state.basis,confirmed:true}});assert.equal(grant.status,200);
 f.s.security.status(f.admin.id,a.user.id,{disabled:true,revision:0,confirmed:true});
 const result=await f.call('/api/browser-fill/preview',{method:'POST',headers:{Origin:'chrome-extension://'+'a'.repeat(32),Authorization:'Bearer '+grant.data.code,'Sec-Fetch-Site':'cross-site'},value:{targetUrl:url}});assert.equal(result.status,403);assert.deepEqual(f.s.questionDraft(a.user.id,j.id).draft,draft);
});
test('failed invitation transaction rolls back consumption and user; each expensive resource has independent quotas',async t=>{
 const f=await fixture(t),i=f.invite('rollback');f.s.db.exec("CREATE TRIGGER reject_security_event BEFORE INSERT ON security_events WHEN NEW.action='invite-redeemed' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
 await assert.rejects(f.s.authenticate({username:'rollback',password,invitation:i.code},true));assert.equal(f.s.db.prepare("SELECT count(*) n FROM users WHERE username='rollback'").get().n,0);assert.equal(f.s.security.invitation(i.code,'rollback').used_by,null);f.s.db.exec('DROP TRIGGER reject_security_event');assert.ok((await f.s.authenticate({username:'rollback',password,invitation:i.code},true)).user.id);
 for(const [kind,count] of Object.entries({upload:30,parse:30,preview:120,generation:30,export:10,admin:30})){for(let n=0;n<count;n++)f.s.security.resource('synthetic-a',kind);assert.throws(()=>f.s.security.resource('synthetic-a',kind),{status:429});assert.doesNotThrow(()=>f.s.security.resource('synthetic-b',kind));}f.advance(300001);assert.doesNotThrow(()=>f.s.security.resource('synthetic-a','upload'));
});

test('confirmation changes and file view reject both member and admin cross-owner IDs without side effects',async t=>{
 let previews=0;const f=await fixture(t,{preview:async()=>{previews++;return{pages:1,images:['synthetic-owner-preview']};}}),a=await f.member('alice'),b=await f.member('bob');
 const j=f.s.saveJob(a.user.id,{company:'PRIVATE_CONFIRMATION_OWNER',title:'Intern'}),file=f.s.saveFile(a.user.id,'private.pdf',Buffer.from('%PDF-1.7 synthetic owner'));
 const confirmation={source:'manual-confirmation',confirmed:true,channel:'employer',date:new Date().toISOString().slice(0,10),receipt:'PRIVATE_RECEIPT_OWNER',requestId:randomUUID()};f.s.confirmSubmission(a.user.id,j.id,confirmation);
 const record=f.s.application(a.user.id,j.id).submissions[0];assert.ok(record.id);
 const before=()=>JSON.stringify(f.s.exportData(a.user.id)).replace(/"exportedAt":"[^"]+"/,'');const snapshot=before();
 for(const auth of [b,f.root]){
  const ownJob=f.s.saveJob(auth.user.id,{company:'Other',title:'Intern'});
  for(const jobId of [j.id,ownJob.id])for(const action of ['correct','withdraw','restore']){
   const r=await f.call('/api/jobs/'+jobId+'/submission-confirmations/'+record.id+'/changes',{auth,method:'POST',value:{action,confirmed:true,revision:0,requestId:randomUUID(),date:confirmation.date}});assert.equal(r.status,404);assert(!r.text.includes('PRIVATE_RECEIPT_OWNER'));
  }
  assert.equal((await f.call('/api/jobs/'+j.id+'/submission-confirmation',{auth,method:'POST',value:{...confirmation,requestId:randomUUID()}})).status,404);
  for(const suffix of ['view','preview','history-preview','trash','restore'])assert.equal((await f.call('/api/files/'+file.id+'/'+suffix,{auth,method:'POST',value:{confirmed:true,name:file.name,sha256:file.sha256}})).status,404,suffix);
  assert.equal((await f.call('/api/files/'+file.id,{auth,method:'DELETE'})).status,404);
  assert.equal((await f.call('/api/jobs/'+j.id,{auth,method:'DELETE'})).status,404);
  for(const path of ['/api/applications','/api/withdrawn-applications'])assert(!(await f.call(path,{auth})).text.includes('PRIVATE_CONFIRMATION_OWNER'));
 }
 assert.equal(previews,0);assert.equal(before(),snapshot);
 assert.equal((await f.call('/api/files/'+file.id+'/view',{auth:a,method:'POST',value:{}})).status,200);assert.equal(previews,1);
 assert.equal((await f.call('/api/jobs/'+j.id+'/submission-confirmations/'+record.id+'/changes',{auth:a,method:'POST',value:{action:'withdraw',confirmed:true,revision:0,requestId:randomUUID()}})).status,200);
 assert.equal(f.s.applications(a.user.id).length,0);assert.equal(f.s.withdrawnApplications(a.user.id).length,1);
});
