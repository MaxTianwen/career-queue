import test from 'node:test';import assert from 'node:assert/strict';
import {termPairs,matchesOpportunity,opportunityFacts,factsLabel} from '../web/v2/opportunity.js';
const base={title:'Software Intern',location:'Toronto, Canada'};
test('mixed-year term alternatives never create a cross-product of years and seasons',()=>{
 const job={...base,term:'Summer 2026 / Winter 2027'};
 assert.deepEqual(termPairs(job),[{season:'summer',year:'2026'},{season:'winter',year:'2027'}]);
 assert(!matchesOpportunity(job,{season:'summer',year:'2027'}));assert(matchesOpportunity(job,{season:'winter',year:'2027'}));assert(matchesOpportunity(job,{season:'summer',year:'2026'}));
 assert(matchesOpportunity(job,{season:'summer',year:''}));assert.match(factsLabel(job),/Summer 2026/);
});
test('shared explicit years, prefix years and unknown years retain conservative meaning',()=>{
 for(const term of ['Summer/Fall 2027','Summer and Fall 2027','2027 Summer / Fall 2027']){
  assert(matchesOpportunity({...base,term},{year:'2027',season:'summer'}));assert(matchesOpportunity({...base,term},{year:'2027',season:'fall'}));assert(!matchesOpportunity({...base,term},{year:'2026',season:'summer'}));
 }
 for(const term of ['Summer',''])assert(matchesOpportunity({...base,term},{year:'2027'}));
 const job={...base,title:'Summer Software Intern',jd:'Graduation expected in 2027. A degree is required.'};assert.deepEqual(termPairs(job),[{season:'summer',year:null}]);assert.match(factsLabel(job),/年份待确认/);
 assert(!matchesOpportunity({...base,title:'2026 Software Intern'},{year:'2027'}));
});
test('year still intersects publication, duration, country and linked placements',()=>{
 const job={...base,term:'Summer 2027',duration:'4 months',postedAt:'2026-10-14T10:00:00Z'};
 const f={year:'2027',season:'summer',months:'4',country:'CA',publication:'24h',now:Date.parse('2026-10-14T20:00:00Z')};assert(matchesOpportunity(job,f));assert(!matchesOpportunity(job,{...f,year:'2026'}));assert(!matchesOpportunity(job,{...f,months:'8'}));assert(!matchesOpportunity({...job,postedAt:null},f));
 const unknown={...base,title:'Software Intern',jd:'Applicants graduating in 2027 or 2028 are welcome.'};assert.equal(opportunityFacts(unknown).terms.length,0);assert(matchesOpportunity(unknown,{year:'2027'}));
});
