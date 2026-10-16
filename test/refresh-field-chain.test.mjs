import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {once} from 'node:events';
import {WorkspaceStore} from '../src/v2/store.mjs';
import {workspaceServer} from '../src/v2/server.mjs';
import {fetchCatalogue,readCatalogueDetail} from '../src/v2/catalogue.mjs';

test('user HTTP refresh parses new and changed official fixtures through merge and SQLite without backfill',async t=>{
 const database=resolve('output/test-runs',randomUUID(),'db.sqlite'),store=new WorkspaceStore(database);
 const password='Synthetic refresh password!';await store.createAdmin({username:'refresh-fixture',password});
 let revision=1,time=Date.now(),detailCalls=0;
 const source={id:'fixture',name:'Synthetic Employer',url:'https://example.com/careers'};
 const raw=id=>({company:'Synthetic Employer',title:'Software Engineering Intern',location:'Toronto, Canada',url:`https://job-boards.greenhouse.io/synthetic/jobs/${id}`});
 const discover=()=>fetchCatalogue({sources:[source],now:time,cachedJobs:store.catalogue().jobs,
  readBoard:async()=>({status:'complete',jobs:revision===1?[raw(900001)]:[raw(900001),raw(900002),raw(900003)]}),
  readDetail:raw=>readCatalogueDetail(raw,async url=>{
   const id=Number(String(url).split('/').pop());assert([900001,900002,900003].includes(id));detailCalls++;
   const mode=id===900003?'Our company supports flexible work.':`This role is categorized as ${revision===1?'onsite':'hybrid'}.`;
   const window=`For 16-month internships: must be available ${revision===1?'May/June 2027 - August/September 2028':'June/July 2027 - September/October 2028'}`;
   const locations=revision===2&&id===900001?'This means the successful candidate is expected to report to Markham Elevation Centre (MEC) or Oshawa Elevation Centre (OEC) three times per week.':'';
   return new Response(JSON.stringify({id,first_published:'2026-10-01',title:raw.title,location:{name:raw.location},content:`<p>${mode}</p><p>${window}</p><p>${locations}</p><p>Develop Python software, maintain tests and collaborate with engineers. Computer science students are welcome.</p>`}),{headers:{'Content-Type':'application/json'}});
  })});
 const server=workspaceServer({legacyRegistration:true, /* Existing pre-email HTTP contract fixture. */database,now:()=>time,discover,online:async()=>true});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{await new Promise(r=>server.close(r));store.close();});
 const origin=`http://127.0.0.1:${server.address().port}`;let auth={};
 async function call(path,value){const r=await fetch(origin+path,{method:value===undefined?'GET':'POST',headers:{Origin:origin,...auth,...(value===undefined?{}:{'Content-Type':'application/json'})},body:value===undefined?undefined:JSON.stringify(value)});const body=await r.json();assert.equal(r.status,200,JSON.stringify(body));return {r,body};}
 const login=await call('/api/login',{username:'refresh-fixture',password});auth={Cookie:login.r.headers.get('set-cookie').split(';')[0],'X-CQ-CSRF':login.body.csrf};
 await call('/api/recommendations/refresh',{});
 let jobs=store.catalogue().jobs;assert.equal(jobs.length,1);assert.equal(jobs[0].workMode,'onsite');assert.deepEqual(jobs[0].durationInfo.windows[0].startOptions,['2027-05','2027-06']);assert.equal(detailCalls,1);
 // Ordinary near-term refresh reuses the full JD; parser still runs on cached prose.
 time+=61000;await call('/api/recommendations/refresh',{});assert.equal(detailCalls,1);assert.equal(store.catalogue().jobs[0].workMode,'onsite');
 revision=2;time+=25*60*60*1000;const renewed=await call('/api/login',{username:'refresh-fixture',password});auth={Cookie:renewed.r.headers.get('set-cookie').split(';')[0],'X-CQ-CSRF':renewed.body.csrf};await call('/api/recommendations/refresh',{});
 jobs=store.catalogue().jobs;assert.equal(jobs.length,3);assert.equal(detailCalls,4);
 const updated=jobs.find(j=>j.url.endsWith('/900001')),added=jobs.find(j=>j.url.endsWith('/900002')),unknown=jobs.find(j=>j.url.endsWith('/900003'));
 for(const j of [updated,added]){assert.equal(j.workMode,'hybrid');assert.deepEqual(j.durationInfo.windows[0].startOptions,['2027-06','2027-07']);assert.deepEqual(j.durationInfo.options,[16]);}
 assert.match(updated.location,/Markham/);assert.match(updated.location,/Oshawa/);assert.equal(unknown.workMode,'unknown');
 assert.deepEqual((await call('/api/applications')).body,[]);assert.deepEqual((await call('/api/jobs')).body,[]);assert.equal((await call('/api/discovery/status')).body.enabled,false);
 const second=new WorkspaceStore(database);try{assert.deepEqual(second.catalogue().jobs,jobs);}finally{second.close();}
});
