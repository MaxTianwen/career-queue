import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogueJob,fetchCatalogue} from '../src/v2/catalogue.mjs';
import {WorkspaceStore} from '../src/v2/store.mjs';
import {durationFacts} from '../src/duration-facts.mjs';
import {factsLabel} from '../web/v2/opportunity.js';
const source={id:'synthetic',name:'Synthetic'};
const raw={company:'Synthetic',title:'Software Engineering Intern',location:'Toronto, Canada',url:'https://example.com/jobs/123',jd:'Engineering internship. Build and test software.',fullJd:true};
for(const [fields,status] of [[{durationText:'12-16 months'},'range'],[{durationMonths:8},'known'],[{durationRange:{min:3,max:4}},'range']])test('duration survives normalization and SQLite '+JSON.stringify(fields),t=>{
 const s=new WorkspaceStore(':memory:');t.after(()=>s.close());
 const job=catalogueJob({...raw,...fields},source);assert.ok(job);assert.equal(durationFacts(job).status,status);
 s.saveCatalogue({jobs:[job],sources:[{...source,status:'complete'}],finishedAt:new Date().toISOString()});
 const stored=s.catalogue().jobs[0];assert.equal(durationFacts(stored).status,status);assert.equal(stored.fullJd,true);assert.equal(factsLabel(stored),factsLabel(job));
 s.saveCatalogue({jobs:[{...job,jd:'Brief listing summary',fullJd:false,durationText:'',durationMonths:null,durationRange:null}],sources:[{...source,status:'complete'}],finishedAt:new Date().toISOString()});
 assert.equal(s.catalogue().jobs[0].jd,raw.jd);assert.equal(durationFacts(s.catalogue().jobs[0]).status,status);
});
test('fresh complete cache keeps structured duration and skips redundant detail request',async()=>{
 const cached=catalogueJob({...raw,durationText:'12-16 months',sourceEvidence:{retrievedAt:new Date().toISOString()}},source);
 const result=await fetchCatalogue({sources:[source],cachedJobs:[cached],readBoard:async()=>({jobs:[{...raw,jd:'',fullJd:false}],status:'complete'}),readDetail:async()=>{throw Error('must use fresh cache');}});
 assert.equal(result.jobs[0].fullJd,true);assert.equal(durationFacts(result.jobs[0]).status,'range');
});
test('explicit summary triggers detail retrieval',async()=>{
 let count=0;const result=await fetchCatalogue({sources:[source],readBoard:async()=>({jobs:[{...raw,jd:'Summary',fullJd:false}],status:'complete'}),readDetail:async()=>{count++;return{...raw,durationMonths:8};}});
 assert.equal(count,1);assert.equal(result.jobs[0].jd,raw.jd);assert.deepEqual(durationFacts(result.jobs[0]).options,[8]);
});
test('invalid structured values cannot fabricate a duration',()=>{
 for(const durationMonths of [0,-1,53,Infinity,'8',8.5])assert.equal(durationFacts({durationMonths}).status,'missing_jd');
 assert.equal(durationFacts({durationRange:{min:16,max:4}}).status,'missing_jd');
});

test('original ranges outrank stale exact structured lengths',()=>{
 const facts=durationFacts({...raw,durationMonths:16,jd:'12-16 month internship (starts May 2027)'});
 assert.deepEqual(facts.options,[]);assert.equal(facts.ranges[0].min,12);assert.equal(facts.ranges[0].max,16);
});
