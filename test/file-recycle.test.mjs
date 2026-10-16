import test from 'node:test';import assert from 'node:assert/strict';import {WorkspaceStore} from '../src/v2/store.mjs';import {workspaceServer} from '../src/v2/server.mjs';import {once} from 'node:events';import {randomUUID} from 'node:crypto';import {resolve} from 'node:path';
const bytes=Buffer.from('%PDF-1.4\n synthetic file for recycle checks'),password='Synthetic File Test Password 2026!';
async function fixture(t){const s=new WorkspaceStore(':memory:');s.db.prepare("UPDATE settings SET value=1 WHERE name='registration_open'").run();t.after(()=>s.close());const a=await s.authenticate({username:'alice',password},true),b=await s.authenticate({username:'bob',password},true);return{s,a:a.user.id,b:b.user.id};}
test('file recycle preserves exact names/bytes, is idempotent, owner checked and export keeps trash',async t=>{
 const {s,a,b}=await fixture(t),name="中文 简历.v2.0 O'Brien.pdf",f=s.saveFile(a,name,bytes),input={confirmed:true,name,sha256:f.sha256};
 assert.equal(f.name,name);assert.throws(()=>s.trashFile(b,f.id,input),{status:404});assert.throws(()=>s.trashFile(a,f.id,{...input,confirmed:false}),{status:409});assert.equal(s.files(a).length,1);
 s.trashFile(a,f.id,input);s.trashFile(a,f.id,input);assert.equal(s.files(a).length,0);assert.equal(s.files(a,{includeDeleted:true}).length,1);assert.throws(()=>s.file(a,f.id),{status:409});assert.throws(()=>s.saveParsed(a,f.id,{text:'a'.repeat(50),parser:'test'}),{status:409});
 const exported=s.exportData(a).files[0];assert(exported.deletedAt);assert.equal(exported.name,name);assert.deepEqual(Buffer.from(exported.base64,'base64'),bytes);assert.equal(s.usage(a).files.count,1);
 assert.throws(()=>s.restoreFile(b,f.id),{status:404});s.restoreFile(a,f.id);s.restoreFile(a,f.id);assert.equal(s.files(a)[0].name,name);assert.deepEqual(Buffer.from(s.file(a,f.id).bytes),bytes);
 for(const n of ['../x.pdf','x\\a.pdf','bad\r\nname.pdf'])assert.throws(()=>s.saveFile(a,n,bytes));
});
test('active files block recycle; historical files archive and retain owned read access',async t=>{
 const {s,a,b}=await fixture(t),f=s.saveFile(a,'original.pdf',bytes),input={confirmed:true,name:f.name,sha256:f.sha256};
 s.saveParsed(a,f.id,{text:'Real synthetic resume text '.repeat(4),parser:'test'});const p=s.parsedResume(a,f.id);s.activateResume(a,{fileId:f.id,confirmed:true,textHash:p.textHash,fileSha:p.fileSha});assert.throws(()=>s.trashFile(a,f.id,input),{status:409});s.clearResume(a);
 const j=s.saveJob(a,{company:'Test',title:'Intern',notes:'keep'});s.db.prepare('INSERT INTO migration_receipts VALUES (?,?,?,?,?,?,?)').run(randomUUID(),a,'source',j.id,'fingerprint',JSON.stringify({original:{company:'Known employer'},documents:[{fileId:f.id,version:'known-version'}]}),Date.now());
 assert.match(s.files(a)[0].origin.label,/Known employer/);assert.equal(s.files(a)[0].deleteBlocked,null);s.trashFile(a,f.id,input);s.trashFile(a,f.id,input);assert.equal(s.files(a).length,0);assert.deepEqual(Buffer.from(s.historyFile(a,f.id).bytes),bytes);assert.throws(()=>s.historyFile(b,f.id),{status:404});s.restoreFile(a,f.id);assert.equal(s.job(a,j.id).notes,'keep');assert.equal(s.db.prepare('SELECT count(*) n FROM file_trash').get().n,0);assert.deepEqual(Buffer.from(s.file(a,f.id).bytes),bytes);
});
test('HTTP filename encoding, CSRF, ownership and trash/restore routes use isolated workspace',async t=>{
 const database=resolve('output/test-runs','file-recycle-'+randomUUID(),'db.sqlite');const setup=new WorkspaceStore(database);setup.db.prepare("UPDATE settings SET value=1 WHERE name='registration_open'").run();setup.close();const server=workspaceServer({legacyRegistration:true, /* Existing pre-email HTTP contract fixture. */database,preview:async()=>({pages:1,images:[]})});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));const origin='http://127.0.0.1:'+server.address().port;
 const register=async username=>{const r=await fetch(origin+'/api/register',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username,password})});const j=await r.json();return{Cookie:r.headers.get('set-cookie').split(';')[0],'X-CQ-CSRF':j.csrf,Origin:origin};};
 const a=await register('alice'),b=await register('bob'),name="中文 空格.v1 O'Brien.pdf";
 let r=await fetch(origin+'/api/files',{method:'POST',headers:{...a,'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(name)},body:bytes});assert.equal(r.status,201);const f=await r.json();assert.equal(f.name,name);
 r=await fetch(origin+'/api/files/'+f.id,{headers:a});assert.equal(r.status,200);assert(r.headers.get('content-disposition').includes('%27'));assert.equal(decodeURIComponent(r.headers.get('content-disposition').split("UTF-8''")[1]),name);
 const call=(action,auth=a,value={confirmed:true,name,sha256:f.sha256})=>fetch(origin+'/api/files/'+f.id+'/'+action,{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify(value)});
 assert.equal((await call('trash',{...a,'X-CQ-CSRF':'wrong'})).status,403);assert.equal((await call('trash',b)).status,404);assert.equal((await call('trash')).status,200);assert.equal((await call('trash')).status,200);
 assert.equal((await(await fetch(origin+'/api/files/trash',{headers:a})).json()).length,1);assert.equal((await fetch(origin+'/api/files/'+f.id,{headers:a})).status,409);assert.equal((await call('restore',b)).status,404);assert.equal((await call('restore')).status,200);assert.equal((await(await fetch(origin+'/api/files',{headers:a})).json()).length,1);
 const store=new WorkspaceStore(database),owner=store.db.prepare("SELECT id FROM users WHERE username='alice'").get().id,job=store.saveJob(owner,{company:'History employer',title:'Intern',notes:'unchanged note'});
 store.db.prepare('INSERT INTO migration_receipts VALUES (?,?,?,?,?,?,?)').run(randomUUID(),owner,'source',job.id,'fingerprint',JSON.stringify({documents:[{fileId:f.id,name:f.name}]}),Date.now());
 const receipt=JSON.stringify(store.db.prepare('SELECT * FROM migration_receipts').all());
 assert.equal((await call('trash')).status,200);
 const historical=await fetch(origin+'/api/files/'+f.id,{headers:a});assert.equal(historical.status,200);assert.deepEqual(Buffer.from(await historical.arrayBuffer()),bytes);
 assert.equal((await fetch(origin+'/api/files/'+f.id,{headers:b})).status,404);
 assert.equal((await call('history-preview')).status,200);assert.equal((await call('history-preview',b)).status,404);assert.equal((await call('preview')).status,409);assert.equal((await call('parse')).status,409);
 assert.equal(store.db.prepare('SELECT count(*) n FROM pdf_reviews').get().n,0);assert.equal(JSON.stringify(store.db.prepare('SELECT * FROM migration_receipts').all()),receipt);assert.equal(store.job(owner,job.id).notes,'unchanged note');store.close();
 assert.equal((await call('restore')).status,200);
 assert.equal((await fetch(origin+'/files.js')).status,200);
});
