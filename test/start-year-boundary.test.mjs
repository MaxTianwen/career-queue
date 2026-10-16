import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {startTerms,inOpportunityYear} from '../src/start-terms.mjs';import {opportunityFacts,factsLabel,matchesOpportunity,mountFilters} from '../web/v2/opportunity.js';
const cases=JSON.parse(readFileSync(new URL('./fixtures/start-year-cases.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
for(const c of cases)test('start-year boundary: '+c.name,()=>{assert.deepEqual(startTerms(c.job),c.terms);assert.equal(inOpportunityYear(c.job),c.included);assert.equal(matchesOpportunity(c.job,{year:'2027'}),c.included);if(!c.terms.length)assert(!/学期未知 20/.test(factsLabel(c.job)));});
test('2027 season filters cannot borrow a different alternative year',()=>{const job=cases.at(-1).job;assert(!matchesOpportunity(job,{year:'2027',season:'summer'}));assert(matchesOpportunity(job,{year:'2027',season:'winter'}));});
test('an internship end season alone never becomes the start term',()=>{const job={title:'Software Intern',jd:'This internship ends in Fall 2028.'};assert.deepEqual(startTerms(job),[]);});
test('graduation class and ending years in a title are not start cohorts',()=>{for(const title of ['Software Internship — Class of 2028','Software Intern ending 2028'])assert.deepEqual(startTerms({title}),[]);});
test('one explicit title cohort stays paired even with role words between season and year',()=>{const job={title:'Summer Software Intern 2026'};assert.deepEqual(startTerms(job),[{season:'summer',year:'2026'}]);assert.equal(inOpportunityYear(job),false);});

test('Qualcomm 3096801 cached windows give Summer 2027 without interpreting FY27',()=>{
 const {job,windows}=JSON.parse(readFileSync(new URL('./fixtures/qualcomm-3096801-start.json',import.meta.url),'utf8'));
 assert.deepEqual(startTerms(job),[{season:'summer',year:'2027'}]);assert.deepEqual(startTerms({title:job.title}),[]);
 for(const months of [12,16])assert(matchesOpportunity(job,{year:'2027',season:'summer',months}));
 assert(!matchesOpportunity(job,{year:'2027',season:'fall',months:16}));
 assert.deepEqual(opportunityFacts(job).durationInfo.windows,windows);
});
test('availability window filters keep length linked to start season and year',()=>{
 const job={title:'Intern',jd:'For 16-month internships: must be available May/June 2027 - August/September 2028\nFor 12-month internships: must be available September/October 2027 - September/October 2028'};
 assert(matchesOpportunity(job,{year:'2027',season:'summer',months:16}));assert(matchesOpportunity(job,{year:'2027',season:'fall',months:12}));
 assert(!matchesOpportunity(job,{year:'2027',season:'summer',months:12}));assert(!matchesOpportunity(job,{year:'2027',season:'fall',months:16}));
});
