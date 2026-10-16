import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {resolve} from 'node:path';
import {nextRateLimit,accessDenied,rateState} from '../src/detail-retry.mjs';
import {fetchCatalogue,catalogueJob,readCatalogueDetail} from '../src/v2/catalogue.mjs';import {WorkspaceStore} from '../src/v2/store.mjs';
import {freshnessSummary} from '../web/v2/opportunity.js';
const now=Date.parse('2026-10-14T20:00:00Z'),source={id:'fixture',name:'Synthetic'};
const base={company:'Synthetic',title:'Software Intern',location:'Toronto, Canada',url:'https://example.com/jobs/1'};
const raw2={...base,url:'https://example.com/jobs/2'},body='Develop software and maintain Python applications. '.repeat(5);
test('Retry-After seconds and HTTP date override bounded exponential backoff without inventing timers',()=>{
 assert.equal(nextRateLimit({retryAfter:'3600'},null,now).nextRetryAt,now+3600000);
 assert.equal(nextRateLimit({retryAfter:'3600',receivedAt:now+60000},null,now).nextRetryAt,now+3660000);
 assert.equal(nextRateLimit({retryAfter:new Date(now+7200000).toUTCString()},null,now).nextRetryAt,now+7200000);
 assert.equal(nextRateLimit({retryAfter:'invalid'},null,now).nextRetryAt,now+300000);
 assert.equal(nextRateLimit({}, {attempts:1},now).nextRetryAt,now+600000);
 assert.equal(nextRateLimit({}, {attempts:100},now).nextRetryAt,now+6*3600000);
 assert.equal(nextRateLimit({retryAfter:'86400'}, {attempts:8},now).nextRetryAt,now+86400000);
 assert(accessDenied({detailAccessDenied:true,detailError:'Prior access refusal; no retry or alternative route'}));
 assert(!accessDenied({detailAccessDenied:true,detailError:'Workday HTTP 429'}));
 assert.equal(rateState({detailAccessDenied:true,detailError:'HTTP 403',detailRateLimit:{status:429}}),null);
});
test('actual detail adapter exposes response Retry-After, no fallback route after 429',async()=>{
 let calls=0;await assert.rejects(readCatalogueDetail({...base,url:'https://careers.amd.com/jobs/91320?icims=1'},async()=>{calls++;return new Response('',{status:429,headers:{'Retry-After':'7200'}});}),e=>e.status===429&&e.retryAfter==='7200');assert.equal(calls,1);
});
test('host cooldown persists in isolated SQLite, keeps old JD, suppresses queued calls and recovers on a later user run',async t=>{
 const s=new WorkspaceStore(resolve('output/test-runs',randomUUID(),'db.sqlite'),{now:()=>now});t.after(()=>s.close());
 s.saveCatalogue({jobs:[catalogueJob({...base,jd:body,sourceEvidence:{retrievedAt:new Date(now-25*3600000).toISOString()}},source)],sources:[{...source,status:'complete'}],finishedAt:new Date(now-25*3600000).toISOString()});
 let calls=0,clock=now,fail=true;
 async function run(){const result=await fetchCatalogue({sources:[source],now:clock,cachedJobs:s.catalogue().jobs,readBoard:async()=>({status:'complete',jobs:[base,raw2]}),readDetail:async raw=>{calls++;if(fail){const e=new Error('HTTP 429');e.status=429;e.retryAfter='3600';throw e;}return{...raw,jd:body+' Current.',sourceEvidence:{retrievedAt:new Date(clock).toISOString()}};}});return s.saveCatalogue(result).jobs;}
 let jobs=await run();assert.equal(calls,1);assert.equal(jobs[0].jd,body);assert(jobs[0].stale);assert.equal(jobs[0].detailAccessDenied,false);assert.equal(jobs[0].detailRateLimit.nextRetryAt,now+3600000);
 clock+=3599999;jobs=await run();assert.equal(calls,1);assert.equal(jobs[0].detailRateLimit.attempts,1);
 clock+=1;fail=false;jobs=await run();assert.equal(calls,3);for(const j of jobs){assert.equal(j.detailRateLimit,null);assert.equal(j.detailError,null);assert.equal(j.stale,false);assert.match(j.jd,/Current/);}
 assert.equal(s.db.prepare('select count(*) n from submissions').get().n,0);assert.equal(s.db.prepare('select count(*) n from jobs').get().n,0);
});
test('legacy 429 may recover after expiry but actual 403/security refusals remain stopped',async()=>{
 for(const [detailError,expectedCalls] of [['HTTP 429',1],['HTTP 403',0],['Prior access refusal; no retry or alternative route',0]]){
  let calls=0;const old={...base,jd:body,sourceEvidence:{retrievedAt:'2026-01-01T00:00:00Z'},detailAccessDenied:true,detailError,detailRetryAt:now-1};
  await fetchCatalogue({sources:[source],now,cachedJobs:[old],readBoard:async()=>({status:'complete',jobs:[base]}),readDetail:async raw=>{calls++;return{...raw,jd:body};}});assert.equal(calls,expectedCalls,detailError);
 }
});
test('freshness text shows stored body and exact failure independently rather than hiding one behind the other',()=>{
 const prior=globalThis.document;globalThis.document={createElement:()=>({})};try{
  const node=freshnessSummary({...base,jd:body,stale:true,sourceUpdatedAt:new Date(now).toISOString(),sourceEvidence:{retrievedAt:'2026-10-01T00:00:00Z'},detailError:'HTTP 429',detailRateLimit:{nextRetryAt:now+3600000}},now);
  assert.match(node.textContent,/列表检查/);assert.match(node.textContent,/正文核验/);assert.match(node.textContent,/HTTP 429/);assert.match(node.textContent,/上次正文/);assert.match(node.textContent,/不自动请求/);
 }finally{globalThis.document=prior;}
});

test('explicit access refusal on a newly listed record is not probed even without a prior cache entry',async()=>{
 let calls=0;const raw={...base,detailAccessDenied:true,detailError:'Prior access refusal; no retry or alternative route'};
 const result=await fetchCatalogue({sources:[source],now,cachedJobs:[],readBoard:async()=>({status:'complete',jobs:[raw]}),readDetail:async()=>{calls++;throw Error('Must not request');}});
 assert.equal(calls,0);assert.equal(result.jobs[0].detailAccessDenied,true);assert.match(result.jobs[0].detailError,/停止自动重试/);
});
