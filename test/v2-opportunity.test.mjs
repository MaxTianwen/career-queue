import test from 'node:test';
import assert from 'node:assert/strict';
import {platform,opportunityFacts,matchesOpportunity} from '../web/v2/opportunity.js';
const job={title:'Software Intern',jd:'Internship term: Summer 2027, 4/8/12 months.',location:'Toronto, Canada',url:'https://job-boards.greenhouse.io/example/jobs/123',classification:{track:'cs'}};
test('combined term duration location and category filters intersect with explicit duration options',()=>{
 assert.equal(matchesOpportunity(job,{season:'summer',months:'8',location:'TORONTO',category:'cs'}),true);
 for(const f of [{season:'winter'},{months:'17'},{location:'Vancouver'},{category:'data'}])assert.equal(matchesOpportunity(job,f),false);
 assert.deepEqual(opportunityFacts(job).durations,[{min:4,max:4},{min:8,max:8},{min:12,max:12}]);
});
test('unknown facts are not invented or silently included and graduation terms do not become start terms',()=>{
 const missing={title:'Analyst Intern',jd:'Graduating in Fall 2027. 12 months of experience required.'};
 assert.deepEqual(opportunityFacts(missing).seasons,[]);assert.deepEqual(opportunityFacts(missing).durations,[]);
 assert.equal(matchesOpportunity(missing,{season:'fall',months:'4'}),false);
 assert.equal(matchesOpportunity(missing,{season:'fall',months:'4',unknown:true}),true);
 assert.equal(matchesOpportunity(job,{season:'winter',unknown:true}),false);
});
test('platform capabilities require a verified supported host and job path, other ATS keep manual preparation',()=>{
 assert.equal(platform(job.url).questions,true);
 assert.equal(platform('https://job-boards.greenhouse.io/example').name,'Greenhouse');
 for(const url of ['https://job-boards.greenhouse.io.evil.com/x/jobs/123','http://job-boards.greenhouse.io/x/jobs/123','https://job-boards.greenhouse.io/x','https://jobs.ashbyhq.com/x/123',''])assert.equal(platform(url).questions,false);
 assert.equal(platform('https://jobs.ashbyhq.com/x/123').name,'Ashby');
 assert.equal(matchesOpportunity(job,{platform:'Ashby'}),false);
});

test('duration in internship sentences is recognized without guessing unrelated engineering categories',()=>{
 assert.deepEqual(opportunityFacts({jd:'This is a 4-month internship.'}).durations,[{min:4,max:4}]);
 assert.equal(opportunityFacts({title:'Mechanical Engineer Intern'}).track,'unknown');
});

test('normal short internship titles survive discovery while unknown roles remain unknown', async()=>{
 const {classifyResume}=await import('../src/resume-track.mjs');
 const {catalogueJob}=await import('../src/v2/catalogue.mjs');
 for(const title of ['Software Intern','Software Co-op','SWE Intern','SDE Internship','Intern – Software','Data Intern']) {
  const raw={title,company:'Synthetic',location:'Toronto, Canada',url:'https://example.com/job'};
  assert.notEqual(classifyResume(raw).track,'unknown',title);
  assert.ok(catalogueJob(raw,{id:'fixture',name:'Synthetic'}),title);
  assert.equal(opportunityFacts(raw).track,classifyResume(raw).track,title);
 }
 for(const title of ['Mechanical Engineer Intern','Summer Intern','Business Development Intern']) {
  const raw={title,location:'Toronto, Canada',url:'https://example.com/job'};
  assert.equal(classifyResume(raw).track,'unknown',title);
  assert.equal(catalogueJob(raw,{id:'fixture',name:'Synthetic'}),null,title);
 }
 assert.equal(matchesOpportunity({title:'Summer Intern'},{category:'cs'}),false);
 assert.equal(matchesOpportunity({title:'Summer Intern'},{category:'cs',unknown:true}),true);
 assert.equal(matchesOpportunity({title:'Software Intern'},{location:'Toronto'}),false);
});
