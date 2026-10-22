import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID}from'node:crypto';import{resolve}from'node:path';import{readFileSync}from'node:fs';
import{jobCountries,remoteFacts,usRemoteEligibility}from'../src/job-country.mjs';import{opportunityScope}from'../src/opportunity-scope.mjs';import{matchesOpportunity,factBadges,mountFilters,normalizeCountry}from'../web/v2/opportunity.js';import{WorkspaceStore}from'../src/v2/store.mjs';import{catalogueJob,fetchCatalogue}from'../src/v2/catalogue.mjs';
const prefs={opportunityScope:'canada-us-remote',excludeCitizenOnly:true},us={title:'Software Engineer Intern',company:'Example',location:'United States',jd:'This position is fully remote. Applicants must reside in the United States. Must be authorized to work in the U.S. No visa sponsorship.'};
test('US needs explicit full remote and CS; restrictions are retained, Canada multinational retained',()=>{
 assert.equal(opportunityScope(us,prefs).excluded,false);assert.ok(remoteFacts(us).restrictions.length>=2);
 for(const job of [{...us,jd:'We offer remote, hybrid, and onsite options.'},{...us,jd:'This is not fully remote.'},{...us,jd:'Fully remote.',workMode:'hybrid'},{...us,jd:'Remote office position.'},{...us,title:'Marketing Analyst Intern',jd:'Fully remote.'},{...us,location:'Remote (United Kingdom)',jd:'Fully remote.'}])assert.equal(opportunityScope(job,prefs).excluded,true,JSON.stringify(job));
 assert.equal(opportunityScope({...us,company:'US multinational',location:'Toronto, Canada',jd:'Hybrid internship'},prefs).excluded,false);
 assert.deepEqual(jobCountries({location:'Toronto, Canada / United States'}),['CA','US']);assert.deepEqual(jobCountries({location:'Remote (United Kingdom)'}),[]);
 assert.equal(remoteFacts({...us,jd:'',fieldEvidence:{workMode:{status:'extracted',source:'workplaceType',raw:'Remote'}}}).fullyRemote,true);
 assert.equal(remoteFacts({...us,jd:'',workMode:'remote'}).fullyRemote,false);
});
test('country combines with season/month/category; clearing UI removes the country constraint',()=>{
 const job={...us,term:'Summer 2027',duration:'8 months',hasPublic:true};assert.equal(matchesOpportunity(job,{country:'CA'}),false);for(const country of ['US','CA-US','all'])assert.equal(matchesOpportunity(job,{country,season:'summer',months:'8',category:'cs'}),true);assert.equal(matchesOpportunity(job,{country:'US',months:'4'}),false);
 const ui=readFileSync('web/v2/opportunity.js','utf8');assert.match(ui,/\['CA','加拿大'\]/);assert.match(ui,/e.name==='country'\?'all':''/);assert.ok(!ui.includes('时长依据'));
});
test('future refresh retains official workplace evidence and accepts US explicit full remote detail',async()=>{
 const source={id:'index',name:'fixture'},raw={...us,url:'https://example.com/jobs/11',location:'US Remote',jd:'',indexInternship:true},old={...raw,jd:'Software engineering internship.',workMode:'remote',fieldEvidence:{workMode:{status:'extracted',source:'workplaceType',raw:'Remote'}},sourceEvidence:{retrievedAt:new Date().toISOString()}};
 const c=await fetchCatalogue({sources:[source],cachedJobs:[old],readIndex:async()=>({jobs:[raw],status:'complete'}),readDetail:()=>{throw Error('cache lost')}});assert.equal(usRemoteEligibility(c.jobs[0]).eligible,true);assert.ok(catalogueJob({...us,url:raw.url},source));
});
test('existing and imported school rules change projection, not source/history; citizen-only remains excluded',t=>{
 const store=new WorkspaceStore(resolve('output/test-runs',randomUUID(),'db.sqlite'));t.after(()=>store.close());const owner=randomUUID();store.db.prepare('INSERT INTO users(id,username,salt,password_hash,preferences) VALUES(?,?,?,?,?)').run(owner,owner,'x','x',JSON.stringify(prefs));
 const text='|Term|ID|Job Title|Organization|Location|Job Description|\n|---|---|---|---|---|---|\n|Summer 2027|123456|Software Intern|Example|United States|This position is fully remote. US residents only.|';store.syncSchoolOpportunities(owner,text);assert.equal(store.pendingSchoolOpportunities(owner).length,1);assert.equal(store.schoolOpportunities(owner).length,1);
 assert.ok(store.citizenExclusion(owner,{...us,location:'Toronto, Canada',jd:'Applicants must be Canadian citizens.'}));const apps=JSON.stringify(store.applications(owner));store.preferences(owner,{direction:'cs'});assert.equal(store.preferences(owner).opportunityScope,prefs.opportunityScope);assert.equal(JSON.stringify(store.applications(owner)),apps);
});
test('US restrictions are visible in card facts which table conversion reuses',()=>{
 const old=globalThis.document;globalThis.document={createElement:tag=>({tag,children:[],append(...items){this.children.push(...items)}})};try{const box=factBadges(us);assert.ok(box.children.some(x=>x.className==='badge country-badge'&&x.textContent==='美国'));const warning=box.children.find(x=>x.className==='country-restrictions');assert.match(warning.textContent,/不代表可从加拿大工作/);assert.match(warning.textContent,/must reside/);assert.match(warning.textContent,/authorized to work/);}finally{globalThis.document=old}
});

test('uncertain full remote and optional office are distinguished; dual-country hybrid does not leak into US view',()=>{for(const jd of ['This may be fully remote.','This is not a fully remote role.'])assert.equal(remoteFacts({...us,jd}).fullyRemote,false);assert.equal(remoteFacts({...us,jd:'This is a remote position. We have offices if the intern would prefer to work in an office.'}).fullyRemote,true);assert.equal(matchesOpportunity({...us,location:'Toronto, Canada / United States',jd:'Hybrid role.'},{country:'US'}),false);assert.equal(matchesOpportunity({...us,location:'Toronto, Canada / United States',jd:'Hybrid role.'},{country:'CA'}),true);});

test('country filter DOM starts at Canada, preserves selection on redraw and clears to all countries',()=>{
 const previous=[globalThis.document,globalThis.Option];class N{constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.events={};this.value='';}setAttribute(k,v){this[k]=v;}append(...items){this.children.push(...items)}add(item){if(!this.children.length)this.value=item.value;this.children.push(item)}addEventListener(k,f){this.events[k]=f}querySelectorAll(){return this.children.flatMap(c=>c instanceof N?[...(['input','select'].includes(c.tag)?[c]:[]),...c.querySelectorAll()]:[])}}
 globalThis.document={createElement:t=>new N(t)};globalThis.Option=class{constructor(text,value){this.text=text;this.value=value}};
 try{const box=new N('div');let count=0;const get=mountFilters(box,()=>count++);assert.equal(get().country,'CA');const country=box.querySelectorAll().find(n=>n.name==='country');assert.deepEqual(country.children.map(x=>[x.text,x.value]),[['加拿大','CA'],['美国','US'],['全部','all']]);country.value='CA-US';assert.equal(get().country,'all');assert.equal(country.value,'all');const migrated=new N('div');assert.equal(mountFilters(migrated,()=>{},{country:'CA-US'})().country,'all');country.value='US';box.events.change();assert.equal(get().country,'US');assert.equal(count,1);box.children.find(n=>n.tag==='button'&&n.className==='filter-reset').events.click();assert.equal(get().country,'all');assert.equal(count,2);}finally{[globalThis.document,globalThis.Option]=previous}
});

test('dual-country fully remote US scope retains US-residency restriction as warning',()=>{assert.equal(opportunityScope({...us,location:'Canada / United States'},prefs).excluded,false);});

test('actual Datacor engineering duties cross Data resume category but do not infer full remote',()=>{
 const j=JSON.parse(readFileSync('test/fixtures/country-role-audit.json','utf8')).find(x=>x.company==='Datacor');
 const f=usRemoteEligibility(j);assert.equal(f.csRelated,true);assert.equal(f.track,'data');assert.equal(f.eligible,false);assert.match(opportunityScope(j,prefs).quote,/fully remote/);
 assert.equal(usRemoteEligibility({...j,jd:j.jd+' This position is fully remote.'}).eligible,true);
 for(const title of ['Machine Learning Engineer Intern','Data Engineer Intern','Platform Engineer Intern','Security Engineer Intern'])assert.equal(usRemoteEligibility({...us,title}).eligible,true,title);
 assert.equal(usRemoteEligibility({...us,title:'Marketing Analyst Intern',jd:'Fully remote. Work with AI engineers. A Computer Science degree is preferred.'}).eligible,false);
});
test('Wex official job Remote Office overrides generic program menu, never role-specific office requirements',()=>{
 const jobs=JSON.parse(readFileSync('test/fixtures/country-role-audit.json','utf8')).filter(x=>x.company==='Wex');assert.equal(jobs.length,4);
 for(const j of jobs){assert.equal(usRemoteEligibility(j).eligible,true,j.title);assert.match(remoteFacts(j).evidence,/Official Workday job location/);
 assert.equal(remoteFacts({...j,jd:j.jd+' This role requires a hybrid schedule.'}).fullyRemote,false);
 assert.equal(remoteFacts({...j,jd:j.jd+' You must attend on-site weekly.'}).fullyRemote,false);
 assert.equal(remoteFacts({...j,sourceEvidence:null}).fullyRemote,false);
 assert.equal(remoteFacts({...j,sourceEvidence:{...j.sourceEvidence,url:'https://example.com/job'}}).fullyRemote,false);
 assert.equal(remoteFacts({...j,location:'Maine / Remote Office / Hybrid, United States'}).fullyRemote,false);
 }
});

test('cross-category CS duties require role actions, not AI company introduction',()=>{
 const base={...us,title:'Research Internship',jd:'Fully remote. We train models for enterprises who are building AI systems.'};assert.equal(usRemoteEligibility(base).csRelated,false);
 assert.equal(usRemoteEligibility({...base,jd:base.jd+'\n- Conduct cutting-edge machine learning research, building and training large language models.'}).csRelated,true);
});

test('legacy combined country migrates to all including other remote locations',()=>{
 assert.equal(normalizeCountry('CA-US'),'all');assert.equal(normalizeCountry(''),'CA');
 const j={...us,location:'Remote (United Kingdom)'};assert.equal(matchesOpportunity(j,{country:'CA-US'}),true);assert.equal(matchesOpportunity(j,{country:'all'}),true);assert.equal(matchesOpportunity(j,{country:'CA'}),false);
});
