import test from 'node:test';import assert from 'node:assert/strict';
import{jobCategory}from'../src/job-category.mjs';import{usRemoteEligibility}from'../src/job-country.mjs';import{matchesOpportunity,factBadges}from'../web/v2/opportunity.js';import{catalogueJob,fetchCatalogue,recommend}from'../src/v2/catalogue.mjs';import{unifiedOpportunities}from'../src/v2/unified-opportunities.mjs';
test('embedded titles and actual duties are independent primary category',()=>{
 for(const title of ['Firmware Engineer Intern','Embedded Software Intern','BSP Intern','RTOS Developer Intern','Device Driver Intern','嵌入式软件实习生'])assert.equal(jobCategory({title}).primary,'embedded',title);
 for(const jd of ['Develop board support packages for controllers.','Design and test firmware for devices.','Debug embedded software on ARM processors.'])assert.equal(jobCategory({title:'Software Intern',jd,classification:{track:'cs'}}).primary,'embedded',jd);
});
test('C++, hardware, ASIC and collaboration with firmware team are insufficient',()=>{
 for(const j of [{title:'Software Intern',jd:'Use C/C++ and Python.'},{title:'Hardware Intern',jd:'Design ASIC circuits and FPGA logic.'},{title:'Software Intern',jd:'Collaborate with firmware engineers. Experience with RTOS is a plus.'},{title:'Data Analyst Intern',jd:'Embedded analytics reports.'},{title:'Delivery Driver Intern'}])assert.notEqual(jobCategory(j).primary,'embedded',JSON.stringify(j));
 assert.notEqual(jobCategory({title:'Software Intern',jd:'Develop firmware.',fullJd:false}).primary,'embedded');
});
test('embedded is exclusive from CS and Data; mixed CS/Data cannot leak into embedded',()=>{
 const j={title:'Firmware Intern',classification:{track:'mixed'},location:'Toronto, Canada'};
 assert.equal(matchesOpportunity(j,{category:'embedded',country:'CA'}),true);for(const category of ['cs','data'])assert.equal(matchesOpportunity(j,{category}),false);
 assert.equal(matchesOpportunity({title:'Software and Data Engineer Intern',classification:{track:'mixed'}},{category:'embedded'}),false);
 assert.equal(matchesOpportunity({title:'Software Intern',classification:{track:'mixed'}},{category:'cs'}),true);
});
test('US fully remote embedded survives software eligibility while hybrid stays excluded',()=>{
 const j={title:'Firmware Intern',location:'United States',jd:'Fully remote.'};assert.equal(usRemoteEligibility(j).eligible,true);assert.equal(matchesOpportunity(j,{country:'US',category:'embedded'}),true);assert.equal(usRemoteEligibility({...j,workMode:'hybrid'}).eligible,false);
});
test('new catalogue and cached detail refresh apply identical category with no extra fetching',async()=>{
 const source={id:'index',name:'fixture'},raw={title:'Firmware Intern',company:'Example',location:'Toronto',url:'https://example.com/jobs/1',indexInternship:true};
 assert.equal(catalogueJob(raw,source).jobCategory.primary,'embedded');
 const old={...raw,jd:'Develop firmware.',sourceEvidence:{retrievedAt:new Date().toISOString()}};
 const result=await fetchCatalogue({sources:[source],readIndex:async()=>({jobs:[{...raw,title:'Software Intern'}],status:'complete'}),cachedJobs:[old],readDetail:()=>{throw Error('must use cached detail')}});assert.equal(result.jobs.length,1);assert.equal(result.jobs[0].jobCategory.primary,'embedded');
});
test('existing school projection uses linked JD without changing source or duplicating matched jobs',()=>{
 const row={title:'Software Intern',company:'Example',schoolId:'123456',location:'Toronto',externalUrl:'https://example.com/jobs/1'};const schools=[{schoolId:'123456',jobId:'saved',row}],saved=[{id:'saved',url:row.externalUrl,jd:'Develop firmware for devices.'}];const before=JSON.stringify({schools,saved});
 const result=unifiedOpportunities('owner',{jobs:[]},schools,saved);assert.equal(result.length,1);assert.equal(result[0].jobCategory.primary,'embedded');assert.equal(JSON.stringify({schools,saved}),before);
 const publicJobs=[{...row,id:'public',url:row.externalUrl,jd:'Develop firmware for devices.'}];const merged=unifiedOpportunities('owner',{jobs:publicJobs},schools,saved);assert.equal(merged.length,1);assert.equal(merged[0].hasSchool,true);assert.equal(merged[0].jobCategory.primary,'embedded');
});
