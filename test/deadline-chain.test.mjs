import {displayDocument} from './helpers/display-dom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {WorkspaceStore} from '../src/v2/store.mjs';
import {catalogueJob,fetchCatalogue,recommend} from '../src/v2/catalogue.mjs';
import {deadlineSummary} from '../web/v2/opportunity.js';
import {availabilityGate} from '../src/v2/availability.mjs';
const source={id:'index',name:'Synthetic'};
const now=Date.parse('2026-10-13T12:00:00Z');
const raw={company:'Synthetic',title:'Software Intern Summer 2027',location:'Toronto, ON',url:'https://job-boards.greenhouse.io/synthetic/jobs/123',jd:'Software internship. Python development and testing. Application deadline: October 12, 2026.',fullJd:true,deadline:'2026-10-12',deadlineEvidence:'Official structured validThrough',sourceEvidence:{retrievedAt:new Date(now-1000).toISOString()}};
function setup(t){const s=new WorkspaceStore(resolve('output/test-runs',randomUUID(),'db.sqlite'),{now:()=>now});t.after(()=>s.close());const owner=randomUUID();s.db.prepare('INSERT INTO users(id,username,salt,password_hash) VALUES (?,?,?,?)').run(owner,owner,'test','test');return {s,owner};}
test('cached complete JD keeps its deadline through index refresh, persistence and recommendation filtering',async t=>{
 const {s}=setup(t),job=catalogueJob(raw,source);s.saveCatalogue({jobs:[job],sources:[{...source,status:'complete'}]});
 const fetchIndex=changes=>fetchCatalogue({sources:[source],now,cachedJobs:[job],readIndex:async()=>({status:'complete',jobs:[{...raw,jd:'',fullJd:false,deadline:null,...changes}]}),readDetail:async()=>{throw Error('cache should avoid a detail fetch');}});
 const fresh=await fetchIndex({});assert.equal(fresh.jobs[0].deadline,raw.deadline);s.saveCatalogue(fresh);assert.equal(s.catalogue().jobs[0].deadline,raw.deadline);assert.equal(recommend(s.catalogue().jobs,{},null,new Date(now)).length,0);
 const extended=await fetchIndex({deadline:'2026-11-01',deadlineEvidence:'Updated official deadline'});assert.equal(extended.jobs[0].deadline,'2026-11-01');s.saveCatalogue(extended);assert.equal(recommend(s.catalogue().jobs,{},null,new Date(now)).length,1);
});
test('detail failure retains deadline and JD; a new complete description can remove or extend a deadline',t=>{
 const {s}=setup(t),job=catalogueJob(raw,source),save=jobs=>s.saveCatalogue({jobs,sources:[{...source,status:'complete'}]});save([job]);
 save([catalogueJob({...raw,jd:'',fullJd:false,deadline:null,detailError:'HTTP 503'},source)]);assert.equal(s.catalogue().jobs[0].deadline,raw.deadline);assert.equal(s.catalogue().jobs[0].stale,true);
 save([catalogueJob({...raw,jd:'',fullJd:false,deadline:'2026-11-02'},source)]);assert.equal(s.catalogue().jobs[0].deadline,'2026-11-02');
 save([catalogueJob({...raw,jd:'A complete new software internship description with no explicit closing date.',deadline:null},source)]);assert.equal(s.catalogue().jobs[0].deadline,null);
});
test('deadline and school closure labels distinguish exact Toronto boundary, unknown status and independent channels',()=>{
 const previous=globalThis.document;globalThis.document=displayDocument();try{
 const job={hasPublic:true,deadline:'2026-10-12',schoolSources:[{schoolId:'900001',row:{deadline:'2026-10-20',sourceStatus:'Closed'}}]};
 assert.doesNotMatch(deadlineSummary(job,new Date('2026-10-13T03:59:59Z')).textContent,/已截止/);
 const text=deadlineSummary(job,new Date('2026-10-13T04:00:00Z')).textContent;assert.match(text,/官网截止：2026-10-12（已截止）/);assert.match(text,/学校状态（900001）：已关闭（学校来源）/);assert.doesNotMatch(text,/学校截止：2026-10-20（已截止）/);
 assert.doesNotMatch(deadlineSummary({schoolSources:[{schoolId:'900002',row:{sourceStatus:'Application Submitted'}}]}).textContent,/已关闭/);
 }finally{globalThis.document=previous;}
});
test('expired saved JD and school deadline block preparation without an external read; failure remains unknown',async t=>{
 const {s,owner}=setup(t);let reads=0;const gate=availabilityGate(s,async()=>{reads++;throw Error('offline');});
 const job=s.saveJob(owner,raw);assert.equal((await gate.refresh(owner,job.id,'test')).status,'closed');assert.equal(reads,0);
 const open=s.saveJob(owner,{...raw,jd:'Software internship with no deadline in supplied text.'});assert.equal((await gate.refresh(owner,open.id,'test')).status,'unknown');assert.equal(reads,1);
 const school={id:'900001',company:'Synthetic school',title:'Software Intern',location:'Toronto, ON',deadline:'2026-10-12',applicationInstructions:'Apply only through school portal.'};s.db.prepare('INSERT INTO school_opportunities VALUES (?,?,?,?)').run(owner,school.id,JSON.stringify(school),now);
 const item=s.schoolOpportunities(owner)[0],draft=s.startSchoolOpportunity(owner,item.schoolId,item.fingerprint);assert.equal((await gate.refresh(owner,draft.id,'test')).status,'closed');assert.equal(reads,1);
});

test('structured catalogue deadline reaches saved application gate and a changed deadline invalidates its check',async t=>{
 const {s,owner}=setup(t);const rawNoDate={...raw,jd:'Software internship with complete duties and no date in prose.'};
 const save=deadline=>s.saveCatalogue({jobs:[catalogueJob({...rawNoDate,deadline},source)],sources:[{...source,status:'complete'}]});
 save('2026-10-12');const job=s.saveSuggested(owner,s.catalogue().jobs[0].id);let reads=0;const gate=availabilityGate(s,async()=>{reads++;return {status:'open'};});
 assert.equal((await gate.refresh(owner,job.id,'test')).status,'closed');assert.equal(reads,0);
 save('2026-11-01');const available=await gate.refresh(owner,job.id,'test');assert.equal(available.status,'open');assert.equal(reads,1);
 save('2026-10-12');assert.throws(()=>gate.require(owner,job.id,'test',{availability:available,openConfirmed:true}),/失效/);
});
