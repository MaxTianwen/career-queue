import test from 'node:test';import assert from 'node:assert/strict';
import {explicitJobRequirements} from '../src/job-requirements.mjs';
import {catalogueJob,fetchCatalogue} from '../src/v2/catalogue.mjs';
import {durationFacts} from '../src/duration-facts.mjs';
import {opportunityFacts} from '../web/v2/opportunity.js';
const base={company:'Synthetic',title:'Software Intern',location:'Toronto, Canada',url:'https://example.com/jobs/1',workMode:'unknown'};
test('explicit role onsite/hybrid requirements are extracted with evidence',()=>{
 for(const [jd,mode]of[
 ['Onsite/Hybrid: This role requires the student to work full time 37.5 hrs a week, in a onsite work structure throughout the duration of the co-op/intern term.','onsite'],
 ['This position is on-site at our Toronto office (24 Ward Street).','onsite'],
 ['Work Arrangement: Hybrid: This role is categorized as hybrid.','hybrid']]){const j=catalogueJob({...base,jd},{id:'test',name:'Synthetic'});assert.equal(j.workMode,mode);assert.equal(j.fieldEvidence.workMode.status,'extracted');}
});
test('general policies, negations, optional modes and conflicting metadata remain unasserted',()=>{
 for(const jd of ['Our company offers hybrid work.','We collaborate with remote teams.','This role is not remote.','This position may be onsite.','This position is onsite or remote.','For example, this position is remote.','We cannot promise this position is remote.','This role is hybrid. This position is onsite.'])assert.equal(explicitJobRequirements({...base,jd}).workMode,'unknown',jd);
 assert.equal(explicitJobRequirements({...base,workMode:'remote',jd:'This role is categorized as hybrid.'}).workMode,'unknown');
});
test('explicit reporting alternatives retain both locations, without collecting generic offices',()=>{
 const jd='This means the successful candidate is expected to report to Markham Elevation Centre (MEC) or Oshawa Elevation Centre (OEC) three times per week at minimum.';
 const a=explicitJobRequirements({...base,location:'Markham Elevation Centre, Canada',jd});
 assert.ok(a.location.includes('Oshawa'));assert.ok(a.location.includes('Canada'));assert.equal(a.fieldEvidence.location.options.length,2);
 assert.equal(explicitJobRequirements(a).location,a.location);
 for(const body of ['Our offices are in Markham or Oshawa.','For example, '+jd,'The successful candidate is not expected to report to Markham or Oshawa three times per week.'])assert.equal(explicitJobRequirements({...base,jd:body}).location,base.location);
});
test('slash-month availability maps known start months to Summer without inventing an exact date',()=>{
 const jd='For 16-month internships: must be available May/June 2027 - August/September 2028';
 const f=durationFacts({...base,jd});assert.deepEqual(f.options,[16]);assert.equal(f.windows.length,1);
 assert.deepEqual(f.windows[0].startOptions,['2027-05','2027-06']);assert.deepEqual(f.windows[0].endOptions,['2028-08','2028-09']);
 assert.deepEqual(f.placements,[]);assert.deepEqual(opportunityFacts({...base,jd}).seasons,['summer']);
 for(const body of ['Expected graduation May/June 2027 - August/September 2028','For 16-month internships: may be available May/June 2027 - August/September 2028','For 16-month internships: must be available May/June 2028 - August/September 2027'])assert.equal(durationFacts({jd:body}).windows.length,0);
});

test('cached full JD also supplies explicit requirements on ordinary refresh',async()=>{
 const cached=catalogueJob({...base,jd:'This position is on-site at our Toronto office.',sourceEvidence:{retrievedAt:new Date().toISOString()}},{id:'test',name:'Synthetic'});
 cached.workMode='unknown';
 const result=await fetchCatalogue({sources:[{id:'test',name:'Synthetic'}],cachedJobs:[cached],readBoard:async()=>({jobs:[base],status:'complete'}),readDetail:async()=>{throw Error('cache should avoid a request')}});
 assert.equal(result.jobs[0].workMode,'onsite');
});