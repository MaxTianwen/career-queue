import test from 'node:test';
import assert from 'node:assert/strict';
import {opportunityFacts,matchesOpportunity,mountFilters} from '../web/v2/opportunity.js';
import {schoolRequirement,channelProgress} from '../web/v2/requirements.js';
import {readView,saveView,mountView} from '../web/v2/opportunity-view.js';
import {identityConflicts} from '../src/v2/unified-opportunities.mjs';
import {WorkspaceStore} from '../src/v2/store.mjs';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
test('duration choices retain exact sets and labelled ranges with range containment filtering',()=>{
 for(const text of ['4/8/12 months','4, 8 or 12 months','4, 8, or 12 months','4 and 8 months','4个月']){const facts=opportunityFacts({term:text});assert.ok(facts.durations.some(d=>d.min===4),text);assert.equal(matchesOpportunity({term:text},{months:'6'}),false);}
 assert.deepEqual(opportunityFacts({term:'4/8/12 months'}).durations.map(d=>d.min),[4,8,12]);
 for(const text of ['8 weeks','6 months','4–16 months']){const facts=opportunityFacts({term:text});assert.equal(facts.durations.length,0,text);assert.deepEqual(facts.durationIssues,[text]);assert.equal(matchesOpportunity({term:text},{months:'4'}),text==='4–16 months');}
 assert.ok(identityConflicts({term:'4/8 months'},{term:'8 months'}).includes('duration'));
 assert.equal(opportunityFacts({jd:'Requires 8 months of experience.'}).durations.length,0);
 assert.equal(matchesOpportunity({term:'8 months'},{months:'4',unknown:true}),false);
 assert.equal(matchesOpportunity({},{months:'4',unknown:true}),true);
});
test('school channel evidence is conservative and contradictions remain unknown',()=>{
 assert.equal(schoolRequirement([{externalUrl:'https://example.com',sourceStatus:'Application Submitted'}]).kind,'unknown');
 assert.equal(schoolRequirement([{jd:'You must apply through both the co-op portal and company website.'}]).kind,'both');
 assert.equal(schoolRequirement([{jd:'Apply only through the co-op portal.'}]).kind,'portal_only');
 assert.equal(schoolRequirement([{jd:'You may apply via the portal or company website; both are optional.'}]).kind,'unknown');
 assert.equal(schoolRequirement([{jd:'Only eligible students should apply through the co-op portal.'}]).kind,'unknown');
 assert.equal(schoolRequirement([{jd:'It is not required to apply through both the portal and company website.'}]).kind,'unknown');
 const conflict=schoolRequirement([{jd:'Apply only through the co-op portal.'}],{jd:'Applicants must apply through both the co-op portal and company website.'});assert.equal(conflict.kind,'unknown');assert.equal(conflict.conflict,true);
 assert.deepEqual(channelProgress('both',[{channel:'school'}]).missing,['employer']);assert.equal(channelProgress('unknown',[{channel:'school'}]).employer,'待确认');assert.equal(channelProgress('school-only',[{channel:'school'}]).employer,'无需提交');assert.equal(channelProgress('both',[{channel:'school'},{channel:'employer',withdrawn:true}]).employer,'待提交');
});
test('portal imported history remains hidden while employer step can be confirmed independently',t=>{
 const store=new WorkspaceStore(resolve('output/test-runs',randomUUID(),'db.sqlite'));t.after(()=>store.close());const owner=randomUUID();store.db.prepare('INSERT INTO users(id,username,salt,password_hash) VALUES (?,?,?,?)').run(owner,owner,'test','test');
 const paste='| Term | ID | Job Title | Organization | Location | App Deadline | App Status |\n|---|---|---|---|---|---|---|\n|2027 - Summer|900001|Software Intern|Synthetic|Toronto|2026-12-31|Application Submitted|';store.syncSchoolOpportunities(owner,paste);
 const original=store.applications(owner)[0];assert.equal(original.channelProgress.portal,'已提交');assert.equal(original.channelProgress.employer,'待确认');
 const job=store.job(owner,original.jobId);store.saveJob(owner,{...job,jd:'Applicants must apply through both the co-op portal and company website.'},job.id);
 let current=store.application(owner,job.id);assert.equal(current.channel,'both');assert.deepEqual(current.channelProgress.missing,['employer']);assert.equal(current.complete,false);assert.equal(current.submissions[0].date,'');
 store.setApplicationChannel(owner,job.id,{channel:'school-only'});assert.equal(store.application(owner,job.id).channelProgress.employer,'无需提交');assert.equal(store.schoolOpportunities(owner)[0].requirement.kind,'portal_only');assert.equal(store.opportunities(owner)[0].schoolSources[0].requirement.kind,'portal_only');store.setApplicationChannel(owner,job.id,{channel:'both'});
 store.confirmSubmission(owner,job.id,{source:'manual-confirmation',confirmed:true,channel:'employer',date:'2026-10-01',receipt:'Synthetic',requestId:randomUUID()});current=store.application(owner,job.id);assert.equal(current.complete,true);assert.equal(current.submissions.find(s=>s.channel==='school').id,original.submissions[0].id);assert.equal(store.pendingSchoolOpportunities(owner).length,0);assert.equal(store.pendingOpportunities(owner).length,0);
});
test('view preferences persist only valid display modes and storage denial is harmless',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};assert.equal(readView(storage,'school'),'cards');saveView(storage,'school','table');assert.equal(readView(storage,'school'),'table');assert.equal(readView(storage,'discovery'),'cards');saveView(storage,'school','invalid');assert.equal(readView(storage,'school'),'table');assert.equal(readView({getItem(){throw Error();}},'school'),'cards');assert.doesNotThrow(()=>saveView({setItem(){throw Error();}},'school','table'));
});
test('school filters omit source and include the evidenced three-month choice',()=>{
 const before=[globalThis.document,globalThis.Option];class N{constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.value='';}setAttribute(k,v){this[k]=v;}append(...children){this.children.push(...children);}add(child){this.children.push(child);}addEventListener(){}querySelectorAll(){return this.children.flatMap(c=>c instanceof N?[...(['select','input'].includes(c.tag)?[c]:[]),...c.querySelectorAll()]:[]);}}
 globalThis.document={createElement:t=>new N(t)};globalThis.Option=class{constructor(text,value){this.text=text;this.value=value;}};
 try{const school=new N('div');mountFilters(school,()=>{},{schoolOnly:true});assert.equal(school.querySelectorAll().some(n=>n.name==='source'),false);assert.deepEqual(school.querySelectorAll().find(n=>n.name==='months').children.map(n=>n.value),['','3','4','8','12','16']);}finally{[globalThis.document,globalThis.Option]=before;}
});
test('table mode moves the same card nodes and actions in original row order',()=>{
 const before=[globalThis.document,globalThis.localStorage];
 class N{constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.events={};this.attrs={};this.className='';this.classList={contains:c=>this.className.split(' ').includes(c),toggle:(c,on)=>{this.className=this.className.split(' ').filter(x=>x!==c).concat(on?[c]:[]).join(' ');}};}setAttribute(k,v){this.attrs[k]=v;}addEventListener(k,v){this.events[k]=v;}append(...children){for(const c of children){c.remove?.();this.children.push(c);c.parentNode=this;}}remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(c=>c!==this);this.parentNode=null;}querySelector(){return null;}insertBefore(c,target){c.parentNode=this;this.children.splice(this.children.indexOf(target),0,c);}matches(selector){return selector.split(',').some(s=>s.startsWith('.')?this.classList.contains(s.slice(1)):this.tag===s);}}
 globalThis.document={createElement:t=>new N(t)};globalThis.localStorage={getItem:()=> 'table',setItem(){}};
 try{const parent=new N('div'),list=new N('div');parent.append(list);const originals=[];for(let i=0;i<2;i++){const card=new N('article');card.className='recommendation-card'+(i===0?' school-opportunity':'');const title=new N('h3'),actions=new N('div'),button=new N('button');actions.className='card-actions';let clicks=0;button.addEventListener('click',()=>clicks++);actions.append(button);card.append(title,actions);list.append(card);originals.push({title,actions,button,clicks:()=>clicks});}mountView(list,'school',()=>{})();const table=list.children[0].children[0],body=table.children[2];assert.equal(body.children.length,2);assert.equal(body.children[0].className,'school-opportunity');for(let i=0;i<2;i++){assert.equal(body.children[i].children[0].children[0],originals[i].title);assert.equal(body.children[i].children[3].children[0],originals[i].actions);originals[i].button.events.click();assert.equal(originals[i].clicks(),1);}assert.equal(list.children[0].tabIndex,0);}finally{[globalThis.document,globalThis.localStorage]=before;}
});
