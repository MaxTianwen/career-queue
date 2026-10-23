import test from 'node:test';
import assert from 'node:assert/strict';
import {jobCategory,titleFamily} from '../src/job-category.mjs';
import {catalogueJob} from '../src/v2/catalogue.mjs';
import {matchesOpportunity} from '../web/v2/opportunity.js';
const source={id:'fixture',name:'Synthetic'};
const raw=title=>({title,location:'Toronto, ON, Canada',url:'https://example.test/jobs/'+encodeURIComponent(title),jd:'',indexInternship:true});
test('hardware, AI/ML, business-analysis and developer titles are kept with their own category',()=>{
 for(const [title,category] of [['Hardware Design Engineer Intern/Co-op','hardware'],['ASIC Verification Engineer Intern/Co-op','hardware'],['Analog and Mixed Signal Engineer Intern','hardware'],['Silicon Validation Intern','hardware'],['Machine Learning Intern','mixed'],['AI/ML Engineer Intern','mixed'],['Credit Risk Intern','business'],['Operations Analyst Co-op Intern','business'],['Product Management Intern/Co-op','business'],['Application Developer Co-op','cs'],['Patient Data Insights Intern','data']]){
  assert.equal(jobCategory(raw(title)).primary,category,title);
  assert.ok(catalogueJob(raw(title),source),title);
 }
 assert.equal(matchesOpportunity({title:'Hardware Design Engineer Intern'},{category:'hardware'}),true);
 assert.equal(matchesOpportunity({title:'Credit Risk Intern'},{category:'business'}),true);
 assert.equal(matchesOpportunity({title:'Credit Risk Intern'},{category:'hardware'}),false);
});
test('mechanical, sales, accounting and generic titles stay out',()=>{
 for(const title of ['Mechanical Engineer Intern','Business Development Intern','Accountant Intern','Marketing Intern','HR Co-op','Sales Intern','Summer Intern','Aerospace Engineering Intern']){
  assert.equal(titleFamily(title),null,title);
  assert.equal(catalogueJob(raw(title),source),null,title);
 }
});
test('direction preference keeps hardware with CS, business analysis with Data and AI/ML with both',async()=>{
 const {recommend}=await import('../src/v2/catalogue.mjs');
 const jobs=['Hardware Design Engineer Intern','Credit Risk Intern','Machine Learning Intern'].map(t=>catalogueJob({...raw(t),jd:''},source));
 const titles=direction=>recommend(jobs,{direction},null).map(j=>j.title).sort();
 assert.deepEqual(titles('cs'),['Hardware Design Engineer Intern','Machine Learning Intern']);
 assert.deepEqual(titles('data'),['Credit Risk Intern','Machine Learning Intern']);
 assert.equal(titles('').length,3);
});
