import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { WorkspaceStore } from '../src/v2/store.mjs';
import { catalogueJob } from '../src/v2/catalogue.mjs';
import { unifiedOpportunities, identityConflicts } from '../src/v2/unified-opportunities.mjs';
import { matchesOpportunity } from '../web/v2/opportunity.js';
const source={id:'test',name:'Synthetic official'};
const raw={company:'Example Labs',title:'Software Intern',location:'Toronto, ON',term:'Summer 2027',requisitionId:'JR12345',url:'https://job-boards.greenhouse.io/example/jobs/12345',jd:'Software internship duration 4 months. Python testing.'};
const pasted=(id='900001',changes={})=>{const r={term:'2027 - Summer',id,title:raw.title,company:raw.company,location:raw.location,req:raw.requisitionId,url:'',status:'Open',...changes};return '|Term|ID|Job Title|Organization|Location|App Deadline|Requisition ID|External URL|App Status|\n|---|---|---|---|---|---|---|---|---|\n'+`|${r.term}|${r.id}|${r.title}|${r.company}|${r.location}||${r.req}|${r.url}|${r.status}|`;};
function setup(t){let now=Date.parse('2026-10-09T14:00:00Z');const s=new WorkspaceStore(resolve('output/test-runs',randomUUID(),'db.sqlite'),{now:()=>now});t.after(()=>s.close());const a=randomUUID(),b=randomUUID();for(const id of [a,b])s.db.prepare('INSERT INTO users(id,username,salt,password_hash) VALUES (?,?,?,?)').run(id,id,'test','test');return {s,a,b,tick:()=>now+=1000,publish:(data=raw)=>s.saveCatalogue({jobs:[catalogueJob(data,source)],sources:[{...source,status:'complete'}],finishedAt:new Date(now).toISOString()})};}
test('unified schools are immediately visible, repeat imports and missing rows preserve identity and owner privacy',t=>{
 const {s,a,b,tick}=setup(t);s.syncSchoolOpportunities(a,pasted());const first=s.opportunities(a)[0];assert.equal(first.hasSchool,true);assert.equal(first.hasPublic,false);assert.equal(s.opportunities(b).length,0);assert.equal(s.catalogue().jobs.length,0);
 tick();s.syncSchoolOpportunities(a,pasted('900001',{status:'Closed'}));const changed=s.opportunities(a)[0];assert.equal(changed.id,first.id);assert.equal(changed.schoolSources[0].row.sourceStatus,'Closed');assert.notEqual(changed.schoolSources[0].updated,first.schoolSources[0].updated);
 s.syncSchoolOpportunities(a,pasted('900002',{req:'JR22222'}));assert.equal(s.opportunities(a).length,2);s.syncSchoolOpportunities(a,pasted('900002',{req:'JR22222'}));assert.equal(s.opportunities(a).length,2);
 assert.throws(()=>s.saveSuggested(b,first.id),/./);assert.equal(matchesOpportunity(changed,{source:'school'}),true);assert.equal(matchesOpportunity(changed,{source:'public'}),false);
});
for(const schoolFirst of [true,false])test('unified import order '+schoolFirst+' reuses a prepared draft and preserves JD/history',t=>{
 const {s,a,b,publish}=setup(t);let draft;
 if(schoolFirst){s.syncSchoolOpportunities(a,pasted());draft=s.saveSuggested(a,s.opportunities(a)[0].id);publish();}
 else{publish();draft=s.saveSuggested(a,s.opportunities(a)[0].id);s.syncSchoolOpportunities(a,pasted());}
 const before=s.job(a,draft.id);const list=s.opportunities(a);assert.equal(list.length,1);assert.equal(list[0].hasSchool,true);assert.equal(list[0].hasPublic,true);assert.equal(list[0].jd,raw.jd);assert.equal(s.saveSuggested(a,list[0].id).id,draft.id);assert.deepEqual(s.job(a,draft.id).jd,before.jd);assert.equal(s.jobs(a).length,1);assert.equal(s.opportunities(b)[0].hasSchool,false);assert.equal(s.application(a,draft.id).submissions.length,0);
 s.syncSchoolOpportunities(a,pasted('900001',{status:'Closed'}));assert.equal(s.opportunities(a)[0].hasPublic,true);assert.equal(s.opportunities(a)[0].schoolSources[0].row.sourceStatus,'Closed');
});
test('unified exact canonical official URL merges without requisition and retains both source timestamps',t=>{
 const {s,a,publish}=setup(t);publish();s.syncSchoolOpportunities(a,pasted('900001',{req:'',url:'https://boards.greenhouse.io/example/jobs/12345/apply?utm_source=school'}));const [j]=s.opportunities(a);assert.equal(s.opportunities(a).length,1);assert.ok(j.publicUpdated);assert.ok(j.schoolSources[0].updated);assert.match(j.schoolSources[0].row.externalUrl,/boards.greenhouse.io/);
});
for(const changes of [{req:'DIFFERENT'},{location:'Vancouver, BC'},{term:'2027 - Fall'},{title:'Software Intern - 8 months'}])test('unified known identity conflict stays separate '+JSON.stringify(changes),t=>{const {s,a,publish}=setup(t);publish();s.syncSchoolOpportunities(a,pasted('900001',{url:raw.url,...changes}));assert.equal(s.opportunities(a).length,2);});
test('unified unique same employer and title merges; ambiguous requisitions do not guess',t=>{
 const {s,a,publish}=setup(t);publish();s.syncSchoolOpportunities(a,pasted('900001',{req:''}));assert.equal(s.opportunities(a).length,1);assert.equal(s.opportunities(a)[0].schoolSources[0].match,'title');
 const publicJob=catalogueJob(raw,source),school={schoolId:'9',row:{...raw,id:'9'},updated:1};delete school.row.url;
 const jobs=[publicJob,{...publicJob,id:'b'.repeat(64),url:'https://example.com/another'}];assert.equal(unifiedOpportunities(a,{jobs},[school],[]).length,3);
 assert.deepEqual(identityConflicts({location:''},{location:'Toronto'}),[]);
});
test('unified explicit mapping overrides differing source fields without changing saved material/submission references',t=>{
 const {s,a,publish}=setup(t);publish();const job=s.saveSuggested(a,s.opportunities(a)[0].id),text=pasted('900001',{location:'Vancouver, BC',req:'OTHER'});const preview=s.schoolPreview(a,text);s.importSchool(a,{text,fingerprint:preview.fingerprint,selections:[{index:0,target:'saved:'+job.id}],confirmed:true,requestId:randomUUID()});
 const before=JSON.stringify(s.job(a,job.id));const list=s.opportunities(a);assert.equal(list.length,1);assert.equal(list[0].schoolSources[0].match,'explicit');assert.ok(list[0].schoolSources[0].conflicts.includes('location'));assert.equal(JSON.stringify(s.job(a,job.id)),before);assert.equal(s.saveSuggested(a,list[0].id).id,job.id);
});

test('unified conflicting URL drafts never become explicit mappings on later reads',t=>{
 const {s,a,publish}=setup(t);publish();const publicId=s.opportunities(a)[0].id,official=s.saveSuggested(a,publicId);
 s.syncSchoolOpportunities(a,pasted('900001',{req:'DIFFERENT',url:raw.url}));const school=s.opportunities(a).find(j=>!j.hasPublic);const draft=s.saveSuggested(a,school.id);assert.notEqual(draft.id,official.id);
 assert.equal(s.opportunities(a).length,2);assert.deepEqual(s.opportunities(a).find(j=>j.hasPublic).draftIds,[official.id]);assert.equal(s.saveSuggested(a,school.id).id,draft.id);
});
test('unified two existing drafts and manual submission history remain on their original job IDs',t=>{
 const {s,a,publish}=setup(t);s.syncSchoolOpportunities(a,pasted());const school=s.saveSuggested(a,s.opportunities(a)[0].id);
 const official=s.saveJob(a,{...raw,notes:''});publish();const list=s.opportunities(a);assert.equal(list.length,1);assert.deepEqual(new Set(list[0].draftIds),new Set([school.id,official.id]));
 const before=JSON.stringify(s.exportData(a));s.opportunities(a);assert.equal(JSON.stringify(s.exportData(a)),before);assert.equal(s.jobs(a).length,2);assert.equal(s.saveSuggested(a,list[0].id).id,school.id);
});

test('unified partial term evidence is unknown rather than a conflicting year',t=>{
 const {s,a,publish}=setup(t);publish({...raw,term:'',title:'Summer Software Intern'});s.syncSchoolOpportunities(a,pasted());assert.equal(s.opportunities(a).length,1);
});
test('unified school maintenance updates both personal views and carries new source evidence',t=>{
 const {s,a,publish}=setup(t);publish();s.syncSchoolOpportunities(a,pasted());s.saveSuggested(a,s.opportunities(a)[0].id);
 const record=s.schoolLinks(a)[0],input={action:'update',revision:record.revision,row:{...record.row,sourceStatus:'Closed'}};
 const plan=s.schoolChangePreview(a,record.schoolId,input);s.changeSchool(a,record.schoolId,{...input,fingerprint:plan.fingerprint,confirmed:true,reason:'Synthetic maintenance',requestId:randomUUID()});
 assert.equal(s.schoolOpportunities(a)[0].row.sourceStatus,'Closed');assert.equal(s.opportunities(a)[0].schoolSources[0].row.sourceStatus,'Closed');assert.equal(s.opportunities(a)[0].hasPublic,true);
});

test('unified duplicate school source identities display one card without silently choosing a portal ID',t=>{
 const {s,a}=setup(t);s.syncSchoolOpportunities(a,pasted('900001'));s.syncSchoolOpportunities(a,pasted('900002'));
 const list=s.opportunities(a);assert.equal(list.length,1);assert.equal(list[0].schoolSources.length,2);assert.throws(()=>s.saveSuggested(a,list[0].id),/多个学校编号/);assert.equal(s.jobs(a).length,0);
 const item=s.schoolOpportunities(a).find(row=>row.schoolId==='900001');const job=s.startSchoolOpportunity(a,item.schoolId,item.fingerprint);assert.equal(s.startSchoolOpportunity(a,item.schoolId,item.fingerprint).id,job.id);assert.equal(s.jobs(a).length,1);
});
