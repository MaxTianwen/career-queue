import test from 'node:test';import assert from 'node:assert/strict';
import {matchesOpportunity,countryCounts,opportunityFacts} from '../web/v2/opportunity.js';
const job=()=>({id:'same-id',company:'Synthetic',title:'Software Intern 2027',location:'Toronto, Canada',jd:'Start Date: May 2027. Duration: 4 months. Develop software applications.',hasPublic:true});
test('filter facts immediately reflect in-place content and nested evidence updates',()=>{
 const j=job();assert(matchesOpportunity(j,{year:'2027',season:'summer',months:'4'}));j.jd='Start Date: September 2027. Duration: 8 months. Develop software applications.';assert(!matchesOpportunity(j,{season:'summer',months:'4'}));assert(matchesOpportunity(j,{year:'2027',season:'fall',months:'8'}));
 j.company='CACI';j.location='Remote';j.fieldEvidence={workMode:{status:'extracted',source:'workplaceType',raw:'Remote'}};assert(matchesOpportunity(j,{country:'US'}));j.fieldEvidence.workMode.raw='Hybrid';assert(!matchesOpportunity(j,{country:'US'}));
});
test('identical job IDs from different accounts and replacement responses never reuse facts',()=>{
 const a=job(),b={...job(),location:'Boston, United States',jd:'Start Date: January 2028. This is a fully remote software internship for 12 months.',title:'Software Intern 2028'};
 assert(matchesOpportunity(a,{country:'CA',year:'2027',season:'summer'}));assert(!matchesOpportunity(b,{country:'CA',year:'2027'}));assert(matchesOpportunity(b,{country:'US',year:'2028',season:'winter',months:'12'}));assert(matchesOpportunity(a,{country:'CA',season:'summer'}));assert.notDeepEqual(opportunityFacts(a),opportunityFacts(b));
});
test('country totals deduplicate current rows and preserve independent filter intersections',()=>{
 const a=job(),b={...job(),id:'b',company:'CACI',location:'Remote, United States',jd:'Start Date: May 2027. Duration: 4 months. This is a fully remote software internship.'};
 assert.deepEqual(countryCounts([a,a,b],{year:'2027',season:'summer',months:'4'}),{all:2,CA:1,US:1,caOnly:1,usOnly:1,both:0,other:0});assert.equal(countryCounts([a,b],{location:' toronto '}).all,1);assert.equal(countryCounts([a,b],{location:'Boston'}).all,0);a.location='Montreal, Canada';assert.equal(countryCounts([a,b],{location:'toronto'}).all,0);assert.equal(countryCounts([a,b],{location:'montreal'}).CA,1);
});
test('rolling publication window expires without changing job identity or caching a match',t=>{
 const j={...job(),postedAt:'2026-10-16T12:00:00Z'},start=Date.parse(j.postedAt);let clock=start+86400000;t.mock.method(Date,'now',()=>clock);const f={publication:'24h',year:'2027',country:'CA'};assert(matchesOpportunity(j,f));assert.equal(countryCounts([j],f).all,1);clock++;assert(!matchesOpportunity(j,f));assert.equal(countryCounts([j],f).all,0);j.postedAt=new Date(clock).toISOString();assert(matchesOpportunity(j,f));j.publicationEvidence={postedAtField:'updated_at'};assert(!matchesOpportunity(j,f));
});
test('changing filters never reuses membership and unknown does not override explicit contradictions',()=>{
 const j=job();for(const f of [{year:'2028'},{season:'winter'},{months:'16'},{location:'Boston'},{category:'data'}])assert(!matchesOpportunity(j,{...f,unknown:true}));assert(matchesOpportunity(j,{country:'all',year:'2027',season:'summer',months:'4',location:'TORONTO',category:'cs'}));assert(matchesOpportunity(j,{}));
});
