import test from 'node:test';
import assert from 'node:assert/strict';
import { readInternshipIndex, fetchCatalogue, INDEX_SOURCE } from '../src/v2/catalogue.mjs';
const entry={active:true,is_visible:true,terms:['Summer 2027'],locations:['Toronto, Canada'],title:'Software Engineer',company_name:'Example',url:'https://job-boards.greenhouse.io/example/jobs/123'};
test('public index validates entries and preserves internship evidence without inventing publication dates',async()=>{
 const r=await readInternshipIndex(async()=>new Response(JSON.stringify([entry,{...entry,active:false},{...entry,terms:['Summer 2026']},null])));
 assert.equal(r.jobs.length,1);assert.equal(r.status,'partial');assert.equal(r.jobs[0].indexInternship,true);assert.equal(r.jobs[0].postedAt,undefined);
 await assert.rejects(()=>readInternshipIndex(async()=>new Response('{}')));
});
test('index and employer duplicate URLs merge provenance and retain official text regardless of completion order',async()=>{
 for(const delayIndex of [true,false]) {
 const employer={id:'employer',name:'Employer'};
 const raw={company:'Example',title:'Software Engineer Intern',location:'Toronto',url:entry.url,jd:'Python required'};
 const r=await fetchCatalogue({sources:[INDEX_SOURCE,employer],readIndex:async()=>{if(delayIndex) await new Promise(r=>setTimeout(r,10));return {status:'complete',raw:1,jobs:[{...raw,jd:'',indexInternship:true}]};},readBoard:async()=>{if(!delayIndex)await new Promise(r=>setTimeout(r,10));return {status:'complete',jobs:[raw]};},readDetail:async()=>null});
 assert.equal(r.jobs.length,1);assert.equal(r.jobs[0].jd,raw.jd);assert.equal(r.jobs[0].sources.length,2);
 }
});
test('index failure does not prevent employer results; remote index candidates retain unknown location eligibility',async()=>{
 const r=await fetchCatalogue({sources:[INDEX_SOURCE,{id:'employer',name:'Employer'}],readIndex:async()=>{throw Error('network');},readBoard:async()=>({status:'complete',jobs:[{company:'Example',title:'Software Engineer Intern',location:'Remote',url:entry.url,jd:'Python'}]})});
 assert.equal(r.jobs.length,1);assert.equal(r.sources.find(s=>s.id==='index').status,'failed');
});
