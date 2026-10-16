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

test('self registration is member-only with an empty isolated workspace and anonymous boundaries',async t=>{
 const f=await fixture(t);f.s.setRegistration(f.admin.id,true);
 const a=await f.call('/api/register',{method:'POST',value:{username:'Alice',password,role:'admin',user_id:f.admin.id}});
 assert.equal(a.status,200);assert.equal(a.data.user.role,'member');assert.equal(a.data.user.username,'alice');
 const auth={token:a.headers['set-cookie'][0].match(/cq_v2_session=([^;]+)/)[1],csrf:a.data.csrf};
 assert.equal((await f.call('/api/files',{auth})).data.length,0);assert.deepEqual(f.s.preferences(a.data.user.id),{});
 const privateJob=f.s.saveJob(f.admin.id,{company:'Private sentinel',title:'Private intern'});
 assert.equal((await f.call('/api/jobs/'+privateJob.id,{auth})).status,404);
 for(const route of ['/api/jobs','/api/files','/api/preferences','/api/admin/accounts','/api/session'])assert.equal((await f.call(route)).status,401);
 assert.equal((await f.call('/api/admin/accounts',{auth})).status,403);
 assert.equal((await f.call('/api/jobs',{auth,headers:{'X-CQ-CSRF':'wrong'}})).status,403);
 const settings=await f.call('/api/registration');assert.equal(settings.data.registrationOpen,true);assert.ok(!JSON.stringify(settings.data).includes('alice'));
});
test('self registration validates input and same-origin JSON; duplicate/lost response can recover by login',async t=>{
 const f=await fixture(t);f.s.setRegistration(f.admin.id,true);
 for(const headers of [{Origin:'https://invalid.example'},{Origin:''},{'Sec-Fetch-Site':'cross-site'}])assert.equal((await f.call('/api/register',{method:'POST',value:{username:'alice',password},headers})).status,403);
 assert.equal((await f.call('/api/register',{method:'POST',value:{username:'alice',password},headers:{'Content-Type':'text/plain'}})).status,415);
 for(const value of [{username:'x',password},{username:'alice',password:'short'},{username:{},password}])assert.equal((await f.call('/api/register',{method:'POST',value})).status,400);
 const first=await f.s.authenticate({username:'alice',password},true);
 await assert.rejects(f.s.authenticate({username:'ALICE',password},true),{status:409});
 const login=await f.s.authenticate({username:'alice',password});assert.equal(login.user.id,first.user.id);assert.equal(f.s.session(first.token),null);
 assert.equal(f.s.db.prepare("SELECT count(*) n FROM users WHERE username='alice'").get().n,1);
});
test('two independent stores racing for last self-registration seat never exceed 30 members',async t=>{
 const f=await fixture(t);f.s.setRegistration(f.admin.id,true);
 for(let i=0;i<29;i++)f.s.db.prepare("INSERT INTO users(id,username,salt,password_hash) VALUES(?,?,?,?)").run(randomUUID(),'fixture'+i,'synthetic','synthetic');
 const other=new WorkspaceStore(f.database);t.after(()=>other.close());
 const results=await Promise.allSettled([f.s.authenticate({username:'lastone',password},true),other.authenticate({username:'lasttwo',password},true)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const failure=results.find(r=>r.status==='rejected').reason;assert.equal(failure.status,409);assert.match(failure.message,/名额已满/);
 assert.equal(f.s.db.prepare("SELECT count(*) n FROM users WHERE role='member'").get().n,30);assert.equal(f.s.db.prepare('SELECT count(*) n FROM users').get().n,31);
});
test('duplicate concurrent registration and session failure roll back cleanly; retry succeeds',async t=>{
 const f=await fixture(t);f.s.setRegistration(f.admin.id,true);
 const results=await Promise.allSettled([1,2].map(()=>f.s.authenticate({username:'alice',password},true)));assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.find(x=>x.status==='rejected').reason.status,409);
 f.s.db.exec("CREATE TRIGGER fail_session BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT,'synthetic session failure'); END");
 await assert.rejects(f.s.authenticate({username:'retryuser',password},true));assert.equal(f.s.db.prepare("SELECT count(*) n FROM users WHERE username='retryuser'").get().n,0);
 f.s.db.exec('DROP TRIGGER fail_session');assert.equal((await f.s.authenticate({username:'retryuser',password},true)).user.role,'member');
});
test('registration closes during password derivation and rate limits return retry guidance',async t=>{
 const f=await fixture(t);f.s.setRegistration(f.admin.id,true);const pending=f.s.authenticate({username:'racing',password},true);f.s.setRegistration(f.admin.id,false);await assert.rejects(pending,{status:403});assert.equal(f.s.db.prepare("SELECT count(*) n FROM users WHERE username='racing'").get().n,0);
 f.s.setRegistration(f.admin.id,true);let limited;for(let i=0;i<22;i++)limited=await f.call('/api/register',{method:'POST',value:{username:'limited',password:'short'}});assert.equal(limited.status,429);assert.ok(Number(limited.headers['retry-after'])>0);
 assert.equal((await f.call('/api/register',{method:'POST',value:{username:'otheruser',password}})).status,200);
});
