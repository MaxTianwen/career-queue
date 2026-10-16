import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {jobCountries,countryFilterFacts,employerCountry} from '../src/job-country.mjs';import {matchesOpportunity,factBadges} from '../web/v2/opportunity.js';import {opportunityScope} from '../src/opportunity-scope.mjs';
const usRemote={company:'Wex',title:'Software Intern',location:'Remote (United States | Canada)',jd:'This role is fully remote.',workMode:'remote',postedAt:'2026-10-14T10:00:00Z',term:'Summer 2027',duration:'4 months'};
test('confirmed US employer remote uses US filter only while Canadian onsite/hybrid locations remain Canada',()=>{
 assert.deepEqual(countryFilterFacts(usRemote).countries,['US']);assert(!matchesOpportunity(usRemote,{country:'CA'}));assert(matchesOpportunity(usRemote,{country:'US'}));assert(matchesOpportunity(usRemote,{country:'all'}));
 for(const mode of ['onsite','hybrid']){const j={...usRemote,location:'Toronto, Canada',jd:`This role is ${mode}.`,workMode:mode};assert(matchesOpportunity(j,{country:'CA'}));assert(!matchesOpportunity(j,{country:'US'}));}
 assert.equal(opportunityScope(usRemote,{opportunityScope:'canada-us-remote'}).excluded,false);
});
test('real screenshot is Canadian 1Password with dual-country workplace, not invented US company domicile',()=>{
 const j=JSON.parse(readFileSync('test/fixtures/country-filter-screenshot.json','utf8'));assert.equal(j.company,'1Password');assert.equal(j.location,'Remote (United States | Canada)');assert.equal(employerCountry(j).country,'CA');assert(matchesOpportunity(j,{country:'CA'}));assert(matchesOpportunity(j,{country:'all'}));
 const previous=globalThis.document;globalThis.document={createElement:tag=>({tag,children:[],append(...x){this.children.push(...x)}})};try{const badge=factBadges(j);assert(badge.children.some(x=>x.className==='badge employer-country'&&x.textContent==='公司国家：加拿大'));assert(badge.children.some(x=>x.className==='country-restrictions'&&x.textContent.includes('并非公司国家')));}finally{globalThis.document=previous;}
});
test('US places sharing Canada city names, explicit US residency, and unknown remote never leak into Canada',()=>{
 for(const location of ['Ontario, California, United States','Toronto, Ohio, United States','Burlington, Vermont, United States','Canada, KY, United States']){const j={title:'Software Intern',location,jd:'Fully remote.'};assert.deepEqual(jobCountries(j),['US']);assert(!matchesOpportunity(j,{country:'CA'}));assert.equal(opportunityScope(j,{opportunityScope:'canada-us-remote'}).excluded,false);}
 const restricted={...usRemote,company:'Unknown company',location:'Remote (Canada / United States)',jd:'This role is fully remote. Applicants must reside in the United States.'};assert.deepEqual(jobCountries(restricted),['US']);for(const jd of ['This role is US-only.','Applicants must be US residents only.']){assert.deepEqual(jobCountries({...restricted,jd}),['US']);assert(!matchesOpportunity({...restricted,jd},{country:'CA'}));}assert(!matchesOpportunity(restricted,{country:'CA'}));
 assert.deepEqual(jobCountries({location:'Remote'}),[]);assert.deepEqual(jobCountries({location:'Headquarters: Toronto; United States'}),['US']);assert.equal(employerCountry({company:'Unverified US Corporation',location:'Canada'}),null);
 assert(!matchesOpportunity({location:'Remote'},{country:'CA',unknown:true}));
});
test('country assignment still intersects rolling publication and duration filters',()=>{
 const f={country:'US',publication:'24h',now:Date.parse('2026-10-14T18:00:00Z'),months:'4',season:'summer'};assert(matchesOpportunity(usRemote,f));assert(!matchesOpportunity(usRemote,{...f,country:'CA'}));assert(!matchesOpportunity(usRemote,{...f,months:'8'}));assert(!matchesOpportunity({...usRemote,postedAt:null},f));
});

test('US postal-state disambiguation does not turn Canadian province or CA country shorthand into US',()=>{
 for(const location of ['Toronto, Ohio','Toronto, OH','Burlington, Vermont','Burlington, VT','Ontario, OR','Vancouver, WA','Toronto (OH)'])assert.deepEqual(jobCountries({location}),['US'],location);
 for(const location of ['Toronto, ON','Burlington, Ontario','Vancouver, BC','Toronto, CA'])assert.deepEqual(jobCountries({location}),['CA'],location);
 assert.deepEqual(jobCountries({location:'Toronto, ON / Burlington, VT'}),['CA','US']);
 assert.deepEqual(jobCountries({location:'Remote in any location'}),[]);
});
test('new official employer evidence changes only fully remote country assignment',()=>{
 for(const company of ['CACI','Cadence Solutions']){
  const job={...usRemote,company,location:'Remote'};
  assert.equal(employerCountry(job).country,'US');assert(!matchesOpportunity(job,{country:'CA'}));assert(matchesOpportunity(job,{country:'US'}));assert(matchesOpportunity(job,{country:'all'}));
  assert(matchesOpportunity({...job,workMode:'hybrid',location:'Toronto, Canada',jd:'This role is hybrid.'},{country:'CA'}));
 }
 assert.equal(employerCountry({company:'Vena Solutions'}).country,'CA');
 for(const company of ['ONE Finance','Cohere','Unknown company'])assert.equal(employerCountry({company}),null);
});
