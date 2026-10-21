import {factBadges} from '../web/v2/opportunity.js';
import test from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{randomUUID}from'node:crypto';import{resolve}from'node:path';import{opportunityScope}from'../src/opportunity-scope.mjs';import{durationFacts}from'../src/duration-facts.mjs';import{parseStructuredJob,publicStructuredJob}from'../src/public-structured-job.mjs';import{WorkspaceStore}from'../src/v2/store.mjs';import{fetchCatalogue}from'../src/v2/catalogue.mjs';
const p={opportunityScope:'canada-or-remote'};
test('fixed account geography accepts Canada and unconfirmed remote, rejects foreign hybrid and explicit remote residency',()=>{
 for(const location of['Toronto, ON','Vancouver, Canada','St. Johns, NL','Various Locations in the GTA','Greater Toronto Area'])assert.equal(opportunityScope({location,workMode:'hybrid'},p).excluded,false);
 assert.equal(opportunityScope({location:'Remote',workMode:'remote'},p).review,true);
 for(const job of[{location:'London, UK',workMode:'hybrid'},{location:'Remote in USA'},{location:'Remote, US'},{location:'Remote in Australia'},{location:'Remote',jd:'Applicants must reside in Germany for this internship.'},{location:'999 REMOTE, United States of America'},{location:'Worldwide remote',jd:'Student must be located in the United States for the duration of the internship.'},{location:'San Francisco, CA',workMode:'onsite'}])assert.equal(opportunityScope(job,p).excluded,true);
 assert.equal(opportunityScope({location:'Remote in USA'},{location:'Remote, US'},{location:'Remote in Australia'},{location:'Remote',jd:'Applicants must reside in Germany for this internship.'},{location:'999 REMOTE, United States of America'},{}).excluded,false);
 assert.equal(opportunityScope({location:'Remote, Canada / USA'},p).excluded,false);
});
test('duration handles four alternatives, parenthetical month count and explicit term dates, excludes graduation horizons',()=>{
 assert.deepEqual(durationFacts({title:'Internship 4/8/12/16 months'}).options,[4,8,12,16]);
 assert.deepEqual(durationFacts({jd:'Internship in Winter 2027 lasting four (4) months.'}).options,[4]);
 assert.deepEqual(durationFacts({jd:'Available for the Winter 2027 Term (January to April).'}).intervals.map(x=>[x.start,x.end]),[['2027-01','2027-04']]);
 assert.deepEqual(durationFacts({jd:'Internship placement: graduation within 12 months.'}).options,[]);
});
test('official URL establishes exact JSON-LD identity without identifier and rejects a different canonical job',()=>{
 const c={url:'https://careers-kinaxis.icims.com/jobs/35329/foo/job',title:'Short index title'};const job={ '@type':'JobPosting',url:c.url,title:'Full official title - 8 months',description:'Internship responsibilities and requirements. '.repeat(10)};const html=`<script type="application/ld+json">${JSON.stringify(job)}</script>`;
 assert.equal(parseStructuredJob(html,c).title,job.title);
 assert.throws(()=>parseStructuredJob(`<link rel="canonical" href="https://careers-kinaxis.icims.com/jobs/99999/other/job">${html}`,c),/不匹配/);
});
test('official full title and duration survive a shortened index refresh',async()=>{
 const raw={company:'Synthetic',title:'Software Intern',url:'https://example.com/jobs/123',location:'Toronto',indexInternship:true};const previous={...raw,title:'Software Intern - 8 months',jd:'internship details',duration:'8 months',sourceEvidence:{retrievedAt:new Date().toISOString()}};
 const result=await fetchCatalogue({sources:[{id:'index',name:'Synthetic'}],cachedJobs:[previous],readIndex:async()=>({jobs:[raw],status:'complete'}),readDetail:async()=>{throw Error('should use cache');}});assert.equal(result.jobs[0].title,previous.title);assert.deepEqual(result.jobs[0].durationInfo.options,[8]);
});
test('scope persists through preference edits and isolates owners without deleting school sources',t=>{
 const s=new WorkspaceStore(resolve('output/test-runs',randomUUID(),'db.sqlite'));t.after(()=>s.close());const ids=[randomUUID(),randomUUID()];for(const [i,id]of ids.entries())s.db.prepare('INSERT INTO users(id,username,salt,password_hash,preferences) VALUES(?,?,?,?,?)').run(id,id,'x','x',JSON.stringify(i?{}:p));
 const text='|Term|ID|Job Title|Organization|Location|\n|---|---|---|---|---|\n|Summer 2027|123456|Software Intern|Synthetic|Remote in USA|';for(const id of ids)s.syncSchoolOpportunities(id,text);s.preferences(ids[0],{direction:'cs'});assert.equal(s.preferences(ids[0]).opportunityScope,p.opportunityScope);assert.equal(s.pendingSchoolOpportunities(ids[0]).length,0);assert.equal(s.pendingSchoolOpportunities(ids[1]).length,1);assert.equal(s.schoolOpportunities(ids[0]).length,1);assert.equal(s.eligibilityExclusions(ids[0])[0].reason.kind,'geography');
});
test('ordinary and user-excerpt badges omit duration provenance without mutating evidence',()=>{
 const old=globalThis.document;globalThis.document={createElement:tag=>({tag,children:[],append(...nodes){this.children.push(...nodes)}})};
 try{const job={title:'Software Internship 8 months',location:'Toronto, Canada'};assert.equal(factBadges(job).children.some(n=>n.className==='badge duration-source'),false);const evidence={sourceKind:'user-provided-employer-excerpt',text:'Internship duration: 8 months',url:'https://example.com/jobs/123',fullJd:false};const snapshot=JSON.stringify(evidence);const supplied=factBadges({...job,durationEvidence:evidence,hasSchool:true});assert.equal(supplied.children.some(n=>n.className==='badge duration-source'),false);assert.equal(supplied.children.some(n=>String(n.textContent).includes('时长依据')),false);assert.ok(supplied.children.some(n=>n.className==='badge school-source'));assert.equal(JSON.stringify(evidence),snapshot);assert.equal(durationFacts(job).evidence.length,1);}finally{globalThis.document=old;}
});

test('failed refresh preserves official title, duration, source and denial while retaining complete prior JD',t=>{
 const s=new WorkspaceStore(resolve('output/test-runs',randomUUID(),'db.sqlite'));t.after(()=>s.close());const source={id:'fixture',name:'Synthetic'},job={id:'one',company:'Synthetic',title:'Software Intern 8 months',location:'Toronto',url:'https://example.com/jobs/123',jd:'Original official internship description',source,sourceEvidence:{url:'https://example.com/jobs/123',retrievedAt:'2026-10-10'},duration:'8 months'};
 s.saveCatalogue({jobs:[job],sources:[{...source,status:'complete'}]});s.saveCatalogue({jobs:[{...job,title:'Intern',jd:'',duration:'',sourceEvidence:null,detailAccessDenied:true,detailError:'HTTP 403'}],sources:[{...source,status:'complete'}]});const saved=s.catalogue().jobs[0];assert.equal(saved.title,job.title);assert.equal(saved.sourceEvidence.url,job.url);assert.deepEqual(saved.durationInfo.options,[8]);assert.equal(saved.detailAccessDenied,true);assert.equal(saved.detailError,'HTTP 403');
});

test('SmartRecruiters public API verifies exact company and ID instead of accepting an unrelated canonical page',async()=>{
 const candidate={url:'https://jobs.smartrecruiters.com/Example/123456',company:'Example'};const payload={id:'123456',company:{identifier:'Example'},name:'Software intern 12 months',jobAd:{sections:{jobDescription:{title:'Description',text:'Official internship description. '.repeat(10)}}}};
 const result=await publicStructuredJob(candidate,async()=>new Response(JSON.stringify(payload)));assert.deepEqual(durationFacts(result).options,[12]);assert.match(result.sourceEvidence.url,/companies\/Example\/postings\/123456/);
 await assert.rejects(()=>publicStructuredJob(candidate,async()=>new Response(JSON.stringify({...payload,id:'999999'}))),/不匹配/);
});

test('TRC labelled flexible June-through-August duration retains month precision without invented days',()=>{const f=durationFacts({jd:'This is a paid full-time position. Anticipated duration will be from June through August 2027 (flexible).'});assert.equal(f.status,'dates');assert.deepEqual(f.options,[]);assert.deepEqual(f.intervals.map(i=>[i.start,i.end,i.precision]),[['2027-06','2027-08','month']]);assert.match(f.evidence[0].quote,/flexible/);});
