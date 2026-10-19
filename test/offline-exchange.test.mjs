import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {resolve} from 'node:path';import {execFileSync} from 'node:child_process';
import {WorkspaceStore} from '../src/v2/store.mjs';import {OfflineExchange,archiveTool,jdReview} from '../src/v2/offline-exchange.mjs';import {python} from './helpers/file-view-fixture.mjs';
export const fixtureBytes=input=>JSON.parse(execFileSync(python,['scripts/offline-fixture.py'],{input:JSON.stringify(input),windowsHide:true,maxBuffer:30*1024*1024}));
function setup(t){const store=new WorkspaceStore(resolve('output/test-runs',randomUUID(),'db.sqlite')),owner=randomUUID(),other=randomUUID();for(const id of [owner,other])store.db.prepare('INSERT INTO users(id,username,salt,password_hash) VALUES(?,?,?,?)').run(id,id,'synthetic','synthetic');const offline=new OfflineExchange(store);t.after(()=>store.close());const sources=fixtureBytes({action:'sources'}),resume=store.saveFile(owner,'CS.docx',Buffer.from(sources.cs,'base64'),'resume'),cover=store.saveFile(owner,'CL.docx',Buffer.from(sources.cover,'base64'),'cover'),job=store.saveJob(owner,{company:'Synthetic Alpha',title:'Software Intern',location:'Toronto',url:'https://example.test/apply',jd:'Full synthetic job description. Develop Python and SQL tools, collaborate with teammates, test software and document verified outcomes. Summer 2027, four months.'});return {store,owner,other,offline,resume,cover,job,input:{items:[{jobId:job.id,jdHash:jdReview(job.jd).sha256,resumeId:resume.id,coverId:cover.id}]}};}
async function packReturn(f){const exported=await f.offline.export(f.owner,f.input);assert.equal(exported.exported,true);const bytes=Buffer.from(fixtureBytes({action:'return',base64:exported.base64}).base64,'base64');return {exported,bytes};}
async function alter(bytes,change){const decoded=await archiveTool({action:'unpack',base64:bytes.toString('base64')});change(decoded);return Buffer.from((await archiveTool({action:'pack',files:[{path:'return-manifest.json',base64:Buffer.from(JSON.stringify(decoded.manifest)).toString('base64')},...decoded.files.map(f=>({path:f.path,base64:f.base64}))]})).base64,'base64');}
test('offline export -> actual ZIP inspection -> explicit confirm is immutable, isolated and idempotent',async t=>{const f=setup(t),before=f.store.files(f.owner).map(x=>x.sha256),{exported,bytes}=await packReturn(f);assert(!JSON.stringify(exported).includes('password_hash'));assert.equal(f.offline.list(f.other).length,0);await assert.rejects(f.offline.preview(f.other,bytes,'other'),/本账号/);const p=await f.offline.preview(f.owner,bytes,'session');assert.equal(p.canConfirm,true,JSON.stringify(p));assert(p.rows[0].files.filter(x=>x.key.endsWith('pdf')).every(x=>x.pages===1&&x.rendered));assert.equal(f.offline.list(f.owner).length,0);assert.throws(()=>f.offline.confirm(f.owner,{token:p.token},'session'),/明确确认/);assert.throws(()=>f.offline.confirm(f.other,{token:p.token,confirmed:true,manualReviewAcknowledged:true},'other'),/失效/);const input={token:p.token,confirmed:true,manualReviewAcknowledged:true},saved=f.offline.confirm(f.owner,input,'session');assert.equal(saved.results.length,1);assert.equal(f.store.files(f.owner).length,6);assert.deepEqual(f.offline.confirm(f.owner,input,'session'),saved);const again=await f.offline.preview(f.owner,bytes,'session');assert(again.rows[0].alreadyImported);f.offline.confirm(f.owner,{...input,token:again.token},'session');assert.equal(f.store.files(f.owner).length,6);assert.equal(f.store.application(f.owner,f.job.id).submissions.length,0);assert.equal(f.store.application(f.owner,f.job.id).versions.length,0);assert.deepEqual([f.store.file(f.owner,f.resume.id).sha256,f.store.file(f.owner,f.cover.id).sha256],[f.resume.sha256,f.cover.sha256]);for(const file of Object.values(saved.results[0].files))assert.equal(f.store.fileOrigin(f.owner,file.id).kind,'generated');assert.equal(saved.results[0].validation.truthVerified,false);});
test('offline detects company/title, source/JD changes, duplicates and unknown job IDs',async t=>{const f=setup(t),{bytes}=await packReturn(f);for(const [label,change]of [['company',d=>d.manifest.items[0].company='Wrong'],['source',d=>d.manifest.items[0].sources.resume.sha256='0'.repeat(64)],['duplicate',d=>d.manifest.items.push(d.manifest.items[0])],['unknown',d=>d.manifest.items[0].jobId=randomUUID()]]){const p=await f.offline.preview(f.owner,await alter(bytes,change),'s');assert.equal(p.canConfirm,false,label);}const p=await f.offline.preview(f.owner,bytes,'s');f.store.saveJob(f.owner,{...f.job,jd:f.job.jd+' Changed.'},f.job.id);assert.throws(()=>f.offline.confirm(f.owner,{token:p.token,confirmed:true,manualReviewAcknowledged:true},'s'),/变化/);assert.equal(f.store.files(f.owner).length,2);});
test('offline rejects missing files, extra files, cross-session confirmation and insufficient capacity',async t=>{const f=setup(t),{bytes}=await packReturn(f);const missing=await f.offline.preview(f.owner,await alter(bytes,d=>d.files.pop()),'s');assert.equal(missing.canConfirm,false);assert(missing.rows[0].errors.some(e=>e.includes('缺失')));const p=await f.offline.preview(f.owner,bytes,'s');assert.throws(()=>f.offline.confirm(f.owner,{token:p.token,confirmed:true,manualReviewAcknowledged:true},'changed'),/失效/);for(let i=0;i<15;i++)f.store.saveFile(f.owner,'extra'+i+'.docx',Buffer.from(f.store.file(f.owner,f.resume.id).bytes));const full=await f.offline.preview(f.owner,bytes,'s');assert.equal(full.capacity.fits,false);assert.equal(full.capacity.newFiles,4);assert.throws(()=>f.offline.confirm(f.owner,{token:full.token,confirmed:true,manualReviewAcknowledged:true},'s'),/容量/);});
test('offline export fails individually for missing JD/template and rejects foreign templates',async t=>{const f=setup(t);let response=await f.offline.export(f.owner,{items:[{...f.input.items[0],resumeId:randomUUID()}]});assert.equal(response.exported,false);f.store.saveJob(f.owner,{...f.job,jd:''},f.job.id);response=await f.offline.export(f.owner,f.input);assert(response.errors[0].error.includes('JD'));assert.equal(f.store.db.prepare('SELECT count(*) n FROM offline_packets').get().n,0);});
test('offline malformed archives, unsafe paths, macro payloads and PDF actions are rejected',async()=>{const run=code=>execFileSync(python,['-c',code],{windowsHide:true,maxBuffer:10*1024*1024});for(const path of ['../evil.docx','/evil.docx','C:/evil.docx','a\\evil.docx']){const zip=run(`import io,sys\nfrom zipfile import ZipFile\no=io.BytesIO()\nwith ZipFile(o,'w') as z:z.writestr(${JSON.stringify(path)},'x')\nsys.stdout.buffer.write(o.getvalue())`);await assert.rejects(archiveTool({action:'unpack',base64:zip.toString('base64')}));}const bomb=run("import io,sys\nfrom zipfile import ZipFile,ZIP_DEFLATED\no=io.BytesIO()\nwith ZipFile(o,'w',ZIP_DEFLATED) as z:z.writestr('huge.pdf','x'*6000000)\nsys.stdout.buffer.write(o.getvalue())");await assert.rejects(archiveTool({action:'unpack',base64:bomb.toString('base64')}),/超限/);const bad=run("import io,sys\nfrom pypdf import PdfWriter\nw=PdfWriter();w.add_blank_page(600,800);w.add_js('app.alert(1)');o=io.BytesIO();w.write(o);sys.stdout.buffer.write(o.getvalue())");await assert.rejects(archiveTool({action:'inspect',kind:'pdf',base64:bad.toString('base64')}));const macro=run("import io,sys\nfrom docx import Document\nfrom zipfile import ZipFile\no=io.BytesIO();Document().save(o)\nwith ZipFile(o,'a') as z:z.writestr('word/vbaProject.bin','bad')\nsys.stdout.buffer.write(o.getvalue())");await assert.rejects(archiveTool({action:'inspect',kind:'docx',base64:macro.toString('base64')}),/宏/);});

test('offline partial batches report missing jobs, survive rollback/retry and re-packed identical returns deduplicate',async t=>{
 const f=setup(t),second=f.store.saveJob(f.owner,{...f.job,company:'Synthetic Beta',title:'Data Intern'});f.input.items.push({jobId:second.id,jdHash:jdReview(second.jd).sha256,resumeId:f.resume.id,coverId:f.cover.id});const {bytes}=await packReturn(f);
 const partial=await alter(bytes,d=>{const removed=d.manifest.items.pop();d.files=d.files.filter(x=>!Object.values(removed.files).includes(x.path));});const p=await f.offline.preview(f.owner,partial,'s');assert(p.canConfirm);assert.equal(p.missing.length,1);
 f.store.db.exec("CREATE TRIGGER offline_test_failure BEFORE INSERT ON offline_results BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");const input={token:p.token,confirmed:true,manualReviewAcknowledged:true};assert.throws(()=>f.offline.confirm(f.owner,input,'s'),/synthetic/);assert.equal(f.store.files(f.owner).length,2);f.store.db.exec('DROP TRIGGER offline_test_failure');f.offline.confirm(f.owner,input,'s');assert.equal(f.store.files(f.owner).length,6);
 const repacked=await alter(partial,d=>d.files.reverse()),again=await f.offline.preview(f.owner,repacked,'s');assert(again.rows[0].alreadyImported);f.offline.confirm(f.owner,{...input,token:again.token},'s');assert.equal(f.store.files(f.owner).length,6);
 const exported=f.store.exportData(f.owner);assert.equal(exported.offlineExchange.offline_results.length,1);assert.equal(f.store.exportData(f.other).offlineExchange.offline_results.length,0);
});
test('offline invalidates expired previews and rejects PDF mismatch, more than one page and external Word templates',async t=>{
 const f=setup(t),{bytes}=await packReturn(f),p=await f.offline.preview(f.owner,bytes,'s');const oldNow=f.store.now;f.store.now=()=>oldNow()+11*60*1000;assert.throws(()=>f.offline.confirm(f.owner,{token:p.token,confirmed:true,manualReviewAcknowledged:true},'s'),/失效/);f.store.now=oldNow;
 const pdf=execFileSync(python,['-c',"import io,sys\nfrom reportlab.pdfgen.canvas import Canvas\no=io.BytesIO();c=Canvas(o);c.drawString(40,700,'Different source text');c.showPage();c.save();sys.stdout.buffer.write(o.getvalue())"],{windowsHide:true});const wrong=await alter(bytes,d=>{d.files.find(x=>x.path.endsWith('.pdf')).base64=pdf.toString('base64');});const mismatch=await f.offline.preview(f.owner,wrong,'s');assert(!mismatch.canConfirm);assert(mismatch.rows[0].errors.some(e=>e.includes('词边界')));
 const multiple=execFileSync(python,['-c',"import io,sys\nfrom pypdf import PdfWriter\nw=PdfWriter();w.add_blank_page(600,800);w.add_blank_page(600,800);o=io.BytesIO();w.write(o);sys.stdout.buffer.write(o.getvalue())"],{windowsHide:true});await assert.rejects(archiveTool({action:'inspect',kind:'pdf',base64:multiple.toString('base64')}),/1页/);
 const external=execFileSync(python,['-c',"import io,sys\nfrom docx import Document\nd=Document();d.add_paragraph('Synthetic');d.part.relate_to('https://example.test/template.dotm','http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate',is_external=True);o=io.BytesIO();d.save(o);sys.stdout.buffer.write(o.getvalue())"],{windowsHide:true});await assert.rejects(archiveTool({action:'inspect',kind:'docx',base64:external.toString('base64')}),/外部模板/);
});
test('offline ZIP limits reject duplicate paths, excessive entries and duplicate manifest keys',async()=>{
 for(const code of ["z.writestr('return-manifest.json','{}');z.writestr('RETURN-MANIFEST.JSON','{}')","[z.writestr(str(i)+'.pdf','x') for i in range(33)]","z.writestr('return-manifest.json','{\"packetId\":\"a\",\"packetId\":\"b\"}')"]){const bytes=execFileSync(python,['-c',"import io,sys\nfrom zipfile import ZipFile\no=io.BytesIO()\nwith ZipFile(o,'w') as z:"+code+"\nsys.stdout.buffer.write(o.getvalue())"],{windowsHide:true});await assert.rejects(archiveTool({action:'unpack',base64:bytes.toString('base64')}));}
});

test('offline HTTP routes enforce authentication, CSRF, origin and owner boundaries',async t=>{
 const f=setup(t),{exported,bytes}=await packReturn(f);const {workspaceServer}=await import('../src/v2/server.mjs');const filename=f.store.db.location();
 const admin=await f.store.createAdmin({username:'http-operator',password:'Synthetic HTTP password only!'});
 const server=workspaceServer({database:filename});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});const origin='http://127.0.0.1:'+server.address().port;
 let response=await fetch(origin+'/api/offline/results');assert.equal(response.status,401);
 response=await fetch(origin+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:'http-operator',password:'Synthetic HTTP password only!'})});const cookie=response.headers.get('set-cookie').split(';')[0],session=await response.json(),headers={Origin:origin,Cookie:cookie,'X-CQ-CSRF':session.csrf,'Content-Type':'application/json'};
 response=await fetch(origin+'/api/offline/results',{headers:{Cookie:cookie}});assert.equal(response.status,403);
 response=await fetch(origin+'/api/offline/export',{method:'POST',headers:{...headers,Origin:'https://example.test'},body:JSON.stringify(f.input)});assert.equal(response.status,403);
 response=await fetch(origin+'/api/offline/import-preview',{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream'},body:bytes});assert.equal(response.status,404);
 response=await fetch(origin+'/api/offline/results',{headers});assert.deepEqual(await response.json(),[]);
});

test('JD preview uses exact export body, accepts short text, rejects missing/stale and isolates reviews',async t=>{
 const f=setup(t);const short='Build SQL reports. Test data quality.';
 f.store.saveJob(f.owner,{...f.job,jd:short},f.job.id);
 const second=f.store.saveJob(f.owner,{...f.job,company:'Synthetic Second',jd:'Develop Python tools…'});
 const p=f.offline.previewJobs(f.owner,{items:[{jobId:f.job.id},{jobId:second.id}]});
 assert.equal(p.items[0].jd,short);assert.equal(p.items[0].jdReview.missing,false);assert.equal(p.items[0].jdReview.warnings.length,0);
 assert.equal(p.items[1].jdReview.warnings.length,1);assert.equal(p.items[0].url,f.job.url);
 assert.throws(()=>f.offline.previewJobs(f.other,{items:[{jobId:f.job.id}]}));
 const input={items:p.items.map((row,i)=>({jobId:row.jobId,resumeId:f.resume.id,coverId:f.cover.id,jdHash:row.jdReview.sha256,jdConfirmed:i===0}))};
 const out=await f.offline.export(f.owner,input);assert(out.exported);
 const saved=f.offline.packet(f.owner,out.packetId);assert.equal(saved.items[0].jd,short);assert.equal(saved.items[0].jdReview.confirmed,true);assert.equal(saved.items[1].jdReview.confirmed,false);
 assert.match(saved.items[1].jdReview.status,/不得称为完整/);
 f.store.saveJob(f.owner,{...f.job,jd:short+' Changed.'},f.job.id);
 const stale=await f.offline.export(f.owner,input);assert.equal(stale.exported,false);assert.match(stale.errors[0].error,/旧确认已失效/);
 f.store.saveJob(f.owner,{...f.job,jd:' '},f.job.id);assert.equal(f.offline.previewJobs(f.owner,{items:[{jobId:f.job.id}]}).items[0].jdReview.missing,true);
 assert.equal((await f.offline.export(f.owner,input)).exported,false);
 assert.equal(f.store.db.prepare('SELECT count(*) n FROM offline_packets').get().n,1);
});

function addJobs(f,count){for(let i=1;i<count;i++){const job=f.store.saveJob(f.owner,{...f.job,company:'Synthetic Company '+i,title:'Intern '+i});f.input.items.push({jobId:job.id,jdHash:jdReview(job.jd).sha256,resumeId:f.resume.id,coverId:f.cover.id});}}
const confirmInput=(p,jobIds)=>({token:p.token,confirmed:true,manualReviewAcknowledged:true,...(jobIds?{jobIds}:{})});
test('offline per-job dedup accepts A then A+B and legacy whole-package fingerprints without deleting files',async t=>{
 const f=setup(t);addJobs(f,2);const {bytes}=await packReturn(f);
 const partial=await alter(bytes,d=>{const b=d.manifest.items.pop();d.files=d.files.filter(x=>!Object.values(b.files).includes(x.path));});
 const a=await f.offline.preview(f.owner,partial,'s');f.offline.confirm(f.owner,confirmInput(a),'s');
 // Represent an existing release record: whole-package fingerprint and no unresolved field.
 const old=f.offline.list(f.owner)[0];delete old.unresolved;
 f.store.db.prepare('UPDATE offline_results SET fingerprint=?,snapshot=? WHERE id=?').run('legacy-whole-package',JSON.stringify(old),old.id);
 const before=f.store.files(f.owner).map(x=>[x.id,x.sha256]);
 const full=await f.offline.preview(f.owner,bytes,'s');assert.deepEqual(full.rows.map(r=>r.alreadyImported),[true,false]);assert.equal(full.capacity.newFiles,4);
 const saved=f.offline.confirm(f.owner,confirmInput(full),'s');assert.equal(saved.createdCount,1);assert.equal(saved.reusedCount,1);assert.equal(f.offline.list(f.owner).length,2);assert.equal(f.store.files(f.owner).length,10);
 assert(before.every(([id,sha])=>f.store.file(f.owner,id).sha256===sha));assert.equal(f.store.application(f.owner,f.job.id).submissions.length,0);
});
test('offline document-only errors isolate jobs, selection is enforced, fixed retry reuses the valid job',async t=>{
 const f=setup(t);addJobs(f,2);const {bytes}=await packReturn(f);
 const badPdf=execFileSync(python,['-c',"import io,sys\nfrom reportlab.pdfgen.canvas import Canvas\no=io.BytesIO();c=Canvas(o);c.drawString(40,700,'Synthetic one');c.showPage();c.drawString(40,700,'Synthetic two');c.showPage();c.save();sys.stdout.buffer.write(o.getvalue())"],{windowsHide:true});
 const bad=await alter(bytes,d=>{d.files.find(x=>x.path===d.manifest.items[1].files.resume_pdf).base64=badPdf.toString('base64');});
 const p=await f.offline.preview(f.owner,bad,'s');assert.equal(p.canConfirm,true);assert.equal(p.rows[0].errors.length,0);assert(p.rows[1].errors.some(e=>e.includes('1页')));
 assert.throws(()=>f.offline.confirm(f.owner,confirmInput(p,[p.rows[1].jobId]),'s'),/检查未通过/);
 const saved=f.offline.confirm(f.owner,confirmInput(p,[p.rows[0].jobId]),'s');assert.equal(saved.createdCount,1);assert.equal(saved.skipped.length,1);
 const fixed=await f.offline.preview(f.owner,bytes,'s'),again=f.offline.confirm(f.owner,confirmInput(fixed),'s');assert.equal(again.createdCount,1);assert.equal(again.reusedCount,1);assert.equal(f.store.files(f.owner).length,10);
 const broken=await alter(bytes,d=>{d.files.find(x=>x.path===d.manifest.items[1].files.cover_docx).base64=Buffer.from('not a Word ZIP').toString('base64');});
 const q=await f.offline.preview(f.owner,broken,'s');assert(q.canConfirm);assert.equal(q.rows[0].errors.length,0);assert(q.rows[1].errors.length);
});
test('offline dangerous documents or ZIP structures still reject the entire batch',async t=>{
 const f=setup(t);addJobs(f,2);const {bytes}=await packReturn(f);
 const dangerous=execFileSync(python,['-c',"import io,sys\nfrom pypdf import PdfWriter\nw=PdfWriter();w.add_blank_page(600,800);w.add_js('app.alert(1)');o=io.BytesIO();w.write(o);sys.stdout.buffer.write(o.getvalue())"],{windowsHide:true});
 const bad=await alter(bytes,d=>{d.files.find(x=>x.path.endsWith('.pdf')).base64=dangerous.toString('base64');});await assert.rejects(f.offline.preview(f.owner,bad,'s'),/脚本|动作/);assert.equal(f.offline.list(f.owner).length,0);
 const traversal=await alter(bytes,d=>d.files.push({path:'../outside.pdf',base64:dangerous.toString('base64')}));await assert.rejects(f.offline.preview(f.owner,traversal,'s'),/路径/);
});
test('offline five-job export discloses capacity and import permits chosen rows then content reuse',async t=>{
 const f=setup(t);addJobs(f,5);const check=f.offline.previewJobs(f.owner,f.input);assert.equal(check.capacity.maxNewJobs,4);assert(check.capacity.requiresAcknowledgement);
 const refused=await f.offline.export(f.owner,f.input);assert.equal(refused.exported,false);assert.equal(f.store.db.prepare('SELECT count(*) n FROM offline_packets').get().n,0);
 f.input.capacityAcknowledged=true;const {bytes}=await packReturn(f),p=await f.offline.preview(f.owner,bytes,'s');assert.equal(p.rows.length,5);assert.equal(p.capacity.newFiles,20);assert.equal(p.capacity.fits,false);assert(p.canConfirm);
 const chosen=p.rows.slice(0,4).map(x=>x.jobId),saved=f.offline.confirm(f.owner,confirmInput(p,chosen),'s');assert.equal(saved.createdCount,4);assert.equal(f.store.files(f.owner).length,18);
 // Fifth job's four documents can legitimately reuse already stored identical content.
 const shared=await alter(bytes,d=>{for(const key of Object.keys(d.manifest.items[4].files)){d.files.find(x=>x.path===d.manifest.items[4].files[key]).base64=d.files.find(x=>x.path===d.manifest.items[0].files[key]).base64;}});
 const q=await f.offline.preview(f.owner,shared,'s');assert.equal(q.capacity.newFiles,0);assert(q.capacity.fits);const complete=f.offline.confirm(f.owner,confirmInput(q),'s');assert.equal(complete.createdCount,1);assert.equal(complete.reusedCount,4);assert.equal(f.store.files(f.owner).length,18);const fifth=complete.results.find(x=>x.jobId===q.rows[4].jobId),first=complete.results.find(x=>x.jobId===q.rows[0].jobId);assert.equal(fifth.files.resume_docx.id,first.files.resume_docx.id);assert.match(fifth.files.resume_docx.downloadName,/Synthetic_Company_4/);assert.notEqual(fifth.files.resume_docx.name,first.files.resume_docx.name);
});
test('offline confirms atomically against capacity changes and concurrent import dedup',async t=>{
 const f=setup(t),{bytes}=await packReturn(f);for(let i=0;i<13;i++)f.store.saveFile(f.owner,'capacity'+i+'.docx',Buffer.from(f.store.file(f.owner,f.resume.id).bytes),'resume');
 const p=await f.offline.preview(f.owner,bytes,'s');assert.equal(p.capacity.remainingFiles,5);
 const otherStore=new WorkspaceStore(f.store.db.location()),otherOffline=new OfflineExchange(otherStore);t.after(()=>otherStore.close());
 const q=await otherOffline.preview(f.owner,bytes,'other');
 otherStore.saveFile(f.owner,'concurrent.docx',Buffer.from(f.store.file(f.owner,f.resume.id).bytes),'resume');
 const first=f.offline.confirm(f.owner,confirmInput(p),'s');assert.equal(first.createdCount,1);assert.equal(f.store.files(f.owner).length,20);
 const again=otherOffline.confirm(f.owner,confirmInput(q),'other');assert.equal(again.createdCount,0);assert.equal(again.reusedCount,1);assert.equal(f.store.files(f.owner).length,20);
 const fresh=setup(t),returned=await packReturn(fresh);for(let i=0;i<14;i++)fresh.store.saveFile(fresh.owner,'filler'+i+'.docx',Buffer.from(fresh.store.file(fresh.owner,fresh.resume.id).bytes),'resume');const staged=await fresh.offline.preview(fresh.owner,returned.bytes,'s');assert(staged.capacity.fits);
 fresh.store.saveFile(fresh.owner,'racing-upload.docx',Buffer.from(fresh.store.file(fresh.owner,fresh.resume.id).bytes),'resume');const before=fresh.store.files(fresh.owner).length;assert.throws(()=>fresh.offline.confirm(fresh.owner,confirmInput(staged),'s'),/容量不足/);assert.equal(fresh.store.files(fresh.owner).length,before);assert.equal(fresh.offline.list(fresh.owner).length,0);
});
test('offline changed content, sources, JD and owner remain distinct while existing bytes are reused',async t=>{
 const f=setup(t),{bytes}=await packReturn(f);f.offline.confirm(f.owner,confirmInput(await f.offline.preview(f.owner,bytes,'s')),'s');
 // Metadata-only change creates an audited result version but no duplicate file storage.
 const changed=await alter(bytes,d=>d.manifest.items[0].changes[0].reason+=' Clarified reason');const p=await f.offline.preview(f.owner,changed,'s');assert.equal(p.rows[0].alreadyImported,false);assert.equal(p.capacity.newFiles,0);f.offline.confirm(f.owner,confirmInput(p),'s');assert.equal(f.offline.list(f.owner).length,2);assert.equal(f.store.files(f.owner).length,6);
 const newSource=f.store.saveFile(f.owner,'new-version.docx',Buffer.from(f.store.file(f.owner,f.resume.id).bytes),'resume');f.input.items[0].resumeId=newSource.id;const next=await packReturn(f);const original=await archiveTool({action:'unpack',base64:bytes.toString('base64')});next.bytes=await alter(next.bytes,d=>{for(const key of Object.keys(d.manifest.items[0].files))d.files.find(x=>x.path===d.manifest.items[0].files[key]).base64=original.files.find(x=>x.path===original.manifest.items[0].files[key]).base64;});const q=await f.offline.preview(f.owner,next.bytes,'s');assert.equal(q.rows[0].alreadyImported,false);assert.equal(q.capacity.newFiles,0);f.offline.confirm(f.owner,confirmInput(q),'s');
 f.store.saveJob(f.owner,{...f.job,jd:f.job.jd+' New scope.'},f.job.id);f.input.items[0].jdHash=jdReview(f.store.job(f.owner,f.job.id).jd).sha256;const newer=await packReturn(f);const changedJD=await f.offline.preview(f.owner,newer.bytes,'s');assert.equal(changedJD.rows[0].alreadyImported,false);f.offline.confirm(f.owner,confirmInput(changedJD),'s');
 await assert.rejects(f.offline.preview(f.other,newer.bytes,'other'),/本账号/);assert.equal(f.offline.list(f.other).length,0);
 // Change both returned DOCX and PDF together: only that pair consumes new storage.
 const altered=await alter(newer.bytes,d=>{const item=d.manifest.items[0];const docx=execFileSync(python,['-c',"import io,sys\nfrom docx import Document\nd=Document();d.add_paragraph('Changed synthetic resume.');o=io.BytesIO();d.save(o);sys.stdout.buffer.write(o.getvalue())"],{windowsHide:true});const pdf=execFileSync(python,['-c',"import io,sys\nfrom reportlab.pdfgen.canvas import Canvas\no=io.BytesIO();c=Canvas(o);c.drawString(40,700,'Changed synthetic resume.');c.showPage();c.save();sys.stdout.buffer.write(o.getvalue())"],{windowsHide:true});d.files.find(x=>x.path===item.files.resume_docx).base64=docx.toString('base64');d.files.find(x=>x.path===item.files.resume_pdf).base64=pdf.toString('base64');});
 const last=await f.offline.preview(f.owner,altered,'s');assert.equal(last.rows[0].alreadyImported,false);assert.equal(last.capacity.newFiles,2);assert.equal(f.offline.confirm(f.owner,confirmInput(last),'s').createdCount,1);
});

test('offline byte-capacity boundary is rechecked atomically independently of file slots',async t=>{
 const f=setup(t),{bytes}=await packReturn(f);const initial=await f.offline.preview(f.owner,bytes,'s');
 let filler=20*1024*1024-f.offline.usage(f.owner).size-initial.capacity.newBytes;
 while(filler>0){const size=Math.min(5*1024*1024,filler),data=Buffer.alloc(size,32);data.write('%PDF-');f.store.saveFile(f.owner,'synthetic-capacity.pdf',data);filler-=size;}
 const boundary=await f.offline.preview(f.owner,bytes,'s');assert(boundary.capacity.fits);assert.equal(boundary.capacity.remainingBytes,boundary.capacity.newBytes);
 const before=f.offline.usage(f.owner);f.offline.confirm(f.owner,confirmInput(boundary),'s');assert.equal(f.offline.usage(f.owner).size,20*1024*1024);assert.equal(f.offline.usage(f.owner).n,before.n+4);
});

test('offline reuse of unchanged uploaded originals preserves source origin and future export eligibility',async t=>{
 const f=setup(t),{bytes}=await packReturn(f);
 const same=await alter(bytes,d=>{const item=d.manifest.items[0];for(const [kind,id,text]of [['resume',f.resume.id,'Synthetic Software Resume. Built verified test fixtures with Python.'],['cover',f.cover.id,'Synthetic generic cover letter. I collaborated on verified tasks.']]){
  d.files.find(x=>x.path===item.files[kind+'_docx']).base64=Buffer.from(f.store.file(f.owner,id).bytes).toString('base64');
  const pdf=execFileSync(python,['-c',"import io,sys\nfrom reportlab.pdfgen.canvas import Canvas\no=io.BytesIO();c=Canvas(o);c.drawString(40,700,sys.argv[1]);c.showPage();c.save();sys.stdout.buffer.write(o.getvalue())",text],{windowsHide:true});d.files.find(x=>x.path===item.files[kind+'_pdf']).base64=pdf.toString('base64');
 }});
 const p=await f.offline.preview(f.owner,same,'s');assert.equal(p.capacity.newFiles,2);const saved=f.offline.confirm(f.owner,confirmInput(p),'s');assert.equal(saved.results[0].files.resume_docx.id,f.resume.id);assert.equal(f.store.files(f.owner).length,4);assert.equal(f.store.fileOrigin(f.owner,f.resume.id).kind,'uploaded');assert.equal(f.store.fileOrigin(f.owner,f.cover.id).kind,'uploaded');assert.equal((await f.offline.export(f.owner,f.input)).exported,true);
});


test('offline malformed per-job sources/files preserve valid rows, reject all-invalid, and reuse repaired legacy returns',async t=>{
 const f=setup(t);addJobs(f,2);const {bytes}=await packReturn(f);
 for(const field of ['sources','files'])for(const value of [undefined,null,[],42,'invalid',{}]){
  const malformed=await alter(bytes,d=>{if(value===undefined)delete d.manifest.items[0][field];else d.manifest.items[0][field]=value;});
  const p=await f.offline.preview(f.owner,malformed,'s');assert(p.canConfirm,field+' '+JSON.stringify(value));assert.equal(p.errors.length,0);assert(p.rows[0].errors.some(e=>e.includes(field)));assert.equal(p.rows[1].errors.length,0);
  assert.throws(()=>f.offline.confirm(f.owner,confirmInput(p,[p.rows[0].jobId]),'s'),/检查未通过/);
  const receipt=f.offline.confirm(f.owner,confirmInput(p,[p.rows[1].jobId]),'s');assert.equal(receipt.results.length,1);assert.deepEqual(f.offline.confirm(f.owner,confirmInput(p,[p.rows[1].jobId]),'s'),receipt);
 }
 const bad=await f.offline.preview(f.owner,await alter(bytes,d=>{delete d.manifest.items[0].sources;delete d.manifest.items[1].files;}),'s');assert.equal(bad.canConfirm,false);assert(bad.rows.every(r=>r.errors.length));assert.throws(()=>f.offline.confirm(f.owner,confirmInput(bad),'s'),/有效岗位/);
 // Existing format has no routing fingerprint; repaired return still reuses the valid imported job.
 const fixed=await f.offline.preview(f.owner,bytes,'s');assert.deepEqual(fixed.rows.map(r=>r.alreadyImported),[false,true]);const saved=f.offline.confirm(f.owner,confirmInput(fixed),'s');assert.equal(saved.createdCount,1);assert.equal(saved.reusedCount,1);assert.equal(f.offline.list(f.owner).length,2);assert.equal(f.store.files(f.owner).length,10);
});
