import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {viewNavigation} from '../web/v2/page-stability.js';
import {deadlineSummary} from '../web/v2/opportunity.js';
import {checkAvailability} from '../src/availability.mjs';
import {WorkspaceStore} from '../src/v2/store.mjs';
import {citizenshipFacts} from '../src/citizenship.mjs';
import {usRemoteEligibility} from '../src/job-country.mjs';

function browser(){
 const entries=[null];let index=0,pop;const win={scrollX:0,scrollY:0,scrollTo(x,y){this.scrollX=x;this.scrollY=y;},addEventListener(type,fn){pop=fn;},removeEventListener(){pop=null;},history:{scrollRestoration:'auto',replaceState(state){entries[index]=state;},pushState(state){entries.splice(++index);entries[index]=state;},back(){if(index>0)pop({state:entries[--index]});},forward(){if(index+1<entries.length)pop({state:entries[++index]});}}};return {win,entries};
}
test('view navigation preserves independent scroll, back/forward and does not refetch repeated selection',()=>{
 const {win,entries}=browser();let shown,reads=0;const nav=viewNavigation({window:win,views:['discovery','files'],render:v=>{shown=v;win.scrollY=0;},read:()=>reads++});
 nav.visit('discovery');win.scrollY=700;nav.visit('files');assert.equal(win.scrollY,0);nav.visit('discovery');assert.equal(win.scrollY,700);nav.visit('discovery');assert.equal(entries.length,3);
 win.history.back();assert.equal(shown,'files');assert.equal(win.scrollY,0);win.history.back();assert.equal(shown,'discovery');assert.equal(win.scrollY,700);win.history.forward();assert.equal(shown,'files');assert.equal(reads,3);
 for(const state of entries)assert.deepEqual(Object.keys(state).sort(),['cqNavigation','cqView']);nav.dispose();assert.equal(win.history.scrollRestoration,'auto');
});
test('logout discards all stored positions and old-account history cannot render a prior view',()=>{
 const {win}=browser();let shown;const nav=viewNavigation({window:win,views:['discovery','files'],render:v=>shown=v});nav.visit('discovery');win.scrollY=800;nav.visit('files');nav.reset();nav.visit('discovery');assert.equal(win.scrollY,0);win.history.back();assert.equal(shown,'discovery');assert.equal(win.scrollY,0);
});
test('deadline summary keeps employer and each school deadline separate without inventing dates',()=>{
 const old=globalThis.document;globalThis.document={createElement:()=>({})};try{
 assert.equal(deadlineSummary({}).textContent,'截止日期未提供');
 const card=deadlineSummary({hasPublic:true,deadline:'2027-01-01',schoolSources:[{schoolId:'900001',row:{deadlineText:'Oct 20, 2026'}},{schoolId:'900002',row:{deadline:'2026-10-21'}}]},new Date('2026-10-13T12:00:00Z'));
 assert.equal(card.textContent,'官网截止：2027-01-01 · 学校截止（900001）：Oct 20, 2026 · 学校截止（900002）：2026-10-21');
 }finally{globalThis.document=old;}
});
test('401 official API refusal is unknown with no alternate page attempt and does not mutate the job',async()=>{
 const job={company:'Synthetic',title:'Software Intern',url:'https://job-boards.greenhouse.io/synthetic/jobs/123',jd:'Existing reliable content'},before=structuredClone(job);let calls=0;
 const result=await checkAvailability(job,{fetchImpl:async()=>{calls++;return new Response('Authentication required',{status:401});}});assert.equal(result.status,'unknown');assert.equal(calls,1);assert.deepEqual(job,before);
});
test('copied school list preview, repeats, exact identities and correction preserve channel history',t=>{
 const s=new WorkspaceStore(resolve('output/test-runs',randomUUID(),'db.sqlite'),{now:()=>Date.parse('2026-10-13T12:00:00Z')});t.after(()=>s.close());const owner=randomUUID();s.db.prepare('INSERT INTO users(id,username,salt,password_hash) VALUES (?,?,?,?)').run(owner,owner,'synthetic','synthetic');
 const paste=status=>'|Term|ID|Job Title|Organization|Location|App Status|\n|---|---|---|---|---|---|\n|Summer 2027|900001|Software Intern|Synthetic|Toronto|'+status+'|\n|Summer 2027|900002|Software Intern|Synthetic|Toronto|Shortlist|';
 assert.equal(s.schoolPreview(owner,paste('Shortlist')).rows.length,2);assert.equal(s.schoolOpportunities(owner).length,0);
 s.syncSchoolOpportunities(owner,paste('Shortlist'));s.syncSchoolOpportunities(owner,paste('Shortlist'));assert.equal(s.schoolOpportunities(owner).length,2);assert.equal(s.applications(owner).length,0);
 s.syncSchoolOpportunities(owner,paste('Application Submitted'));const app=s.applications(owner)[0],record=app.submissions[0];assert.equal(record.channel,'school');assert.equal(record.date,'');assert.equal(s.pendingSchoolOpportunities(owner)[0].schoolId,'900002');
 s.setApplicationChannel(owner,app.jobId,{channel:'both'});s.confirmSubmission(owner,app.jobId,{source:'manual-confirmation',confirmed:true,channel:'employer',date:'2026-10-12',receipt:'Synthetic employer receipt',requestId:randomUUID()});
 s.changeConfirmation(owner,app.jobId,record.id,{action:'withdraw',revision:s.confirmations(owner,app.jobId,true).find(r=>r.id===record.id).revision,confirmed:true,requestId:randomUUID(),schoolRevision:s.schoolContext(owner,app.jobId).revision,date:'',receipt:'Synthetic correction'});
 s.syncSchoolOpportunities(owner,paste('Application Submitted'));const remaining=s.applications(owner)[0].submissions;assert.deepEqual(remaining.map(x=>x.channel),['employer']);assert.equal(remaining[0].date,'2026-10-12');assert.equal(s.application(owner,app.jobId).complete,false);assert.equal(s.application(owner,app.jobId).withdrawn[0].id,record.id);
});
test('eligibility distinguishes fully remote US restrictions, hybrid conflict and ordinary PR security review',()=>{
 const base={title:'Software Engineer Intern',location:'United States',jd:'This is a fully remote position. Must reside in the United States. Work authorization is required.'};const remote=usRemoteEligibility(base);assert.equal(remote.eligible,true);assert.ok(remote.restrictions.some(s=>s.includes('Must reside')));assert.equal(usRemoteEligibility({...base,jd:base.jd+' Hybrid schedule required.'}).eligible,false);
 for(const jd of ['Canadian citizens or permanent residents must pass a security clearance.','Candidates must pass a Canadian government security screening.'])assert.equal(citizenshipFacts({jd}).restricted,false);assert.equal(citizenshipFacts({jd:'Only Canadian citizens may apply.'}).restricted,true);
});
