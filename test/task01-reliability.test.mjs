import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { request } from 'node:http';
import { once } from 'node:events';
import { WorkspaceStore } from '../src/v2/store.mjs';
import { workspaceServer } from '../src/v2/server.mjs';
import { catalogueJob, fetchCatalogue, readCatalogueDetail } from '../src/v2/catalogue.mjs';

// Authored complete employer-response fixture, not a live employer or portal fetch.
const source={id:'fixture',name:'Synthetic Employer',url:'https://example.com/careers'};
const base={company:'Synthetic Employer',title:'Software Engineering Intern',location:'Toronto, Canada',term:'Summer 2027',requisitionId:'TEST-900001',url:'https://example.com/jobs/900001'};
const fullJd=months=>`Software Engineering Intern — Summer 2027
About us: Synthetic Employer builds software for internal reporting.
Location: Toronto, Canada. This is a full-time co-op placement.
Work term: This internship lasts ${months} months.
Responsibilities: Develop Python services, maintain SQL queries, write automated tests, review code and document deployment procedures with the engineering team.
Qualifications: Currently enrolled in a computer science program; familiarity with Git, Python and SQL. Prior experience of 12 months is preferred but not required.
Benefits: Employees may receive 16 weeks parental leave. The first 4 weeks of onboarding are training, not the placement length.
Application instructions: Apply through the employer website. The employer will review applications and contact selected candidates.
Equal opportunity: Applications are assessed on job-related qualifications.`;
const evidence=n=>({text:`Internship duration: ${n} months`,url:base.url,capturedAt:`2026-10-${n===4?'01':'14'}T00:00:00Z`,sourceKind:'synthetic full employer response'});
const job=n=>catalogueJob({...base,jd:fullJd(n),fullJd:true,durationEvidence:evidence(n)},source);
const result=jobs=>({jobs,sources:[{...source,status:'complete'}],finishedAt:'2026-10-14T12:00:00Z'});

test('new explicit duration evidence replaces old evidence through discovery and persistence',async t=>{
 const s=new WorkspaceStore(resolve('output/test-runs',randomUUID(),'db.sqlite'));t.after(()=>s.close());
 s.saveCatalogue(result([job(4)]));
 const fresh=await fetchCatalogue({sources:[source],cachedJobs:s.catalogue().jobs,readBoard:async()=>({jobs:[{...base,jd:fullJd(8),fullJd:true,durationEvidence:evidence(8)}],status:'complete'})});
 assert.deepEqual(fresh.jobs[0].durationInfo.options,[8]);
 s.saveCatalogue(fresh);assert.deepEqual(s.catalogue().jobs[0].durationInfo.options,[8]);
 assert.deepEqual(s.catalogue().jobs[0].durationEvidence,evidence(8));
 assert.equal(s.catalogue().jobs[0].jd,fullJd(8));
 // No replacement evidence: preserve existing independently supplied evidence.
 s.saveCatalogue(result([catalogueJob({...base,jd:'Current general responsibilities.'},source)]));
 assert.deepEqual(s.catalogue().jobs[0].durationEvidence,evidence(8));
});

test('HTTP and SQLite journey: replay, failed transaction retry, refresh, channel separation and restart',async t=>{
 const database=resolve('output/test-runs',randomUUID(),'db.sqlite'),setup=new WorkspaceStore(database);
 const password='Synthetic reliability password!';await setup.createAdmin({username:'reliability',password});setup.close();
 let current=result([job(4)]),server,time=Date.now();
 async function start(){server=workspaceServer({legacyRegistration:true, /* Existing pre-email HTTP contract fixture. */database,now:()=>time,discover:async()=>current,online:async()=>true});server.listen(0,'127.0.0.1');await once(server,'listening');}
 async function stop(){if(server?.listening)await new Promise(r=>server.close(r));}
 t.after(stop);await start();let auth={};
 async function call(path,value,method=value===undefined?'GET':'POST'){
  const origin=`http://127.0.0.1:${server.address().port}`,payload=value===undefined?null:Buffer.from(JSON.stringify(value));
  return new Promise((done,reject)=>{const req=request(origin+path,{method,headers:{Origin:origin,...auth,...(payload?{'Content-Type':'application/json','Content-Length':payload.length}:{})}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>done({status:res.statusCode,data:JSON.parse(Buffer.concat(chunks)),headers:res.headers}));});req.on('error',reject);req.end(payload);});
 }
 async function ok(path,value,method){if(path.endsWith("/refresh"))time+=61000;const r=await call(path,value,method);assert.ok([200,201].includes(r.status),`${path}: ${r.status} ${JSON.stringify(r.data)}`);return r.data;}
 async function login(){const r=await call('/api/login',{username:'reliability',password});assert.equal(r.status,200);auth={Cookie:r.headers['set-cookie'][0].split(';')[0],'X-CQ-CSRF':r.data.csrf};}
 await login();
 const paste=(status='Shortlist',location='Toronto, Canada')=>`|Term|ID|Job Title|Organization|Location|App Status|Requisition ID|\n|---|---|---|---|---|---|---|\n|Summer 2027|900001|Software Engineering Intern|Synthetic Employer|${location}|${status}|TEST-900001|`;
 async function input(text){return {text,fingerprint:(await ok('/api/school/preview',{text})).listImport.fingerprint,confirmed:true,requestId:randomUUID()};}
 const initial=await input(paste());const first=await ok('/api/school/opportunities',initial);
 assert.deepEqual(await ok('/api/school/opportunities',initial),first);
 assert.deepEqual(await ok('/api/applications'),[]);
 const [school]=await ok('/api/school/opportunities');
 const draft=await ok('/api/school/opportunities/start',{schoolId:school.schoolId,fingerprint:school.fingerprint});
 await ok(`/api/jobs/${draft.id}`,{...draft,notes:'Keep my own notes'},'PUT');
 assert.deepEqual(await ok('/api/applications'),[]);
 await ok('/api/recommendations/refresh',{});
 let rec=await ok('/api/recommendations');assert.equal(rec.jobs.length,1);assert.deepEqual(rec.jobs[0].durationInfo.options,[4]);
 // A database write failure after school processing must roll back the whole import.
 const submitted=await input(paste('Application Submitted'));
 const db=new WorkspaceStore(database);t.after(()=>db.close());
 db.db.exec("CREATE TRIGGER fixture_fail_receipt BEFORE INSERT ON school_imports BEGIN SELECT RAISE(ABORT,'Synthetic disk failure'); END");
 assert.equal((await call('/api/school/opportunities',submitted)).status,500);
 assert.deepEqual(await ok('/api/applications'),[]);
 db.db.exec('DROP TRIGGER fixture_fail_receipt');
 await ok('/api/school/opportunities',submitted);
 let apps=await ok('/api/applications');assert.equal(apps.length,1);assert.equal(apps[0].submissions.length,1);assert.equal(apps[0].submissions[0].channel,'school');assert.equal(apps[0].submissions[0].date,'');
 await ok(`/api/jobs/${draft.id}/submission-confirmation`,{source:'manual-confirmation',confirmed:true,channel:'employer',date:'2026-10-12',receipt:'Synthetic employer confirmation',requestId:randomUUID()});
 const protectedSubmissions=(await ok('/api/applications'))[0].submissions;
 // Failed source refresh keeps existing source; successful retry replaces fields once.
 current={jobs:[],sources:[{...source,status:'failed'},{id:'other-fixture',status:'complete'}],finishedAt:'2026-10-14T13:00:00Z'};
 await ok('/api/recommendations/refresh',{});assert.equal(db.catalogue().jobs.length,1);assert.equal(db.catalogue().jobs[0].stale,true);
 current=result([job(8)]);await ok('/api/recommendations/refresh',{});
 assert.equal(db.catalogue().jobs.length,1);assert.deepEqual(db.catalogue().jobs[0].durationInfo.options,[8]);
 assert.equal(db.catalogue().jobs[0].jd,fullJd(8));
 await ok('/api/school/opportunities',await input(paste('Shortlist','Toronto, Canada')));
 assert.deepEqual((await ok('/api/applications'))[0].submissions,protectedSubmissions);
 assert.equal((await ok(`/api/jobs/${draft.id}`)).notes,'Keep my own notes');
 assert.equal((await ok('/api/jobs')).length,1);
 assert.equal((await ok('/api/discovery/status')).enabled,false);
 await stop();await start();await login();
 assert.deepEqual(await ok('/api/school/opportunities',initial),first);
 assert.deepEqual((await ok('/api/applications'))[0].submissions,protectedSubmissions);
 assert.equal((await ok('/api/jobs')).length,1);
});

test('complete synthetic official API body is parsed and refreshed without treating experience or leave as tenure',async t=>{
 const s=new WorkspaceStore(resolve('output/test-runs',randomUUID(),'db.sqlite'));t.after(()=>s.close());
 const raw={...base,url:'https://job-boards.greenhouse.io/synthetic/jobs/900001'};
 let months=4,calls=0;
 const fetchFixture=async url=>{
  calls++;assert.equal(String(url),'https://boards-api.greenhouse.io/v1/boards/synthetic/jobs/900001');
  return {ok:true,json:async()=>({id:900001,title:'Software Engineering Intern Summer 2027',first_published:'2026-10-01',location:{name:base.location},content:fullJd(months).split('\n').map(line=>`<p>${line}</p>`).join('')})};
 };
 for(const expected of [4,8]){
  months=expected;const detail=await readCatalogueDetail(raw,fetchFixture);
  assert.equal(detail.jd,fullJd(expected));
  s.saveCatalogue(result([catalogueJob({...raw,...detail},source)]));
  assert.equal(s.catalogue().jobs.length,1);
  assert.deepEqual(s.catalogue().jobs[0].durationInfo.options,[expected]);
  assert.deepEqual(s.catalogue().jobs[0].durationInfo.other,[]);
 }
 assert.equal(calls,2);
});