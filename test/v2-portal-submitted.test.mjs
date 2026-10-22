import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {WorkspaceStore} from '../src/v2/store.mjs';
import {catalogueJob} from '../src/v2/catalogue.mjs';
const paste=(id='900001',status='Application Submitted')=>'|Term|ID|Job Title|Organization|Location|App Deadline|App Status|Requisition ID|\n|---|---|---|---|---|---|---|---|\n'+`|2027 - Summer|${id}|Software Intern|Example Labs|Toronto|2026-12-31|${status}|JR${id}|`;
function setup(t){const database=resolve('output/test-runs',randomUUID(),'db.sqlite');const s=new WorkspaceStore(database,{now:()=>Date.parse('2026-10-09T20:00:00Z')});t.after(()=>s.close());const a=randomUUID(),b=randomUUID();for(const id of [a,b])s.db.prepare('INSERT INTO users(id,username,salt,password_hash) VALUES (?,?,?,?)').run(id,id,'test','test');return{s,a,b,database};}
test('portal submitted import is atomic, owner-scoped, dated unknown, idempotent and hidden from both pending lists',t=>{
 const {s,a,b}=setup(t);const result=s.syncSchoolOpportunities(a,paste());assert.equal(result.submissions.added,1);assert.equal(s.pendingSchoolOpportunities(a).length,0);assert.equal(s.pendingOpportunities(a).length,0);assert.equal(s.schoolOpportunities(a).length,1);
 const [app]=s.applications(a),[record]=app.submissions;assert.equal(record.channel,'school');assert.equal(record.date,'');assert.equal(record.source,'school-portal');assert.equal(s.schoolRecords(a)[0].sources[0].row.company,'Example Labs');assert.equal(record.portalEvidence[0].snapshot.deadline,'2026-12-31');assert.ok(record.portalEvidence[0].firstObserved);assert.equal(s.applications(b).length,0);assert.throws(()=>s.importPortalSubmissions(b,['900001']),/学校编号/);
 assert.equal(s.syncSchoolOpportunities(a,paste()).submissions.existing,1);assert.equal(s.applications(a)[0].submissions[0].id,record.id);
 assert.equal(s.syncSchoolOpportunities(a,paste('900001','')).submissions.added,0);s.syncSchoolOpportunities(a,paste('900002','Shortlist'));assert.equal(s.schoolOpportunities(a).length,2);assert.equal(s.applications(a).length,1);assert.equal(s.pendingSchoolOpportunities(a).length,1);
});
for(const status of ['', 'Shortlist', 'Applied', 'Not Application Submitted', 'Application Submitted Pending'])test('portal does not promote ambiguous status '+status,t=>{const{s,a}=setup(t);s.syncSchoolOpportunities(a,paste('900001',status));assert.equal(s.applications(a).length,0);assert.equal(s.jobs(a).length,0);});
test('portal matching online copy stays hidden after refresh while other account sees public opportunity',t=>{
 const{s,a,b}=setup(t);s.syncSchoolOpportunities(a,paste());const publicJob=catalogueJob({company:'Example Labs',title:'Software Intern',location:'Toronto',term:'Summer 2027',requisitionId:'JR900001',url:'https://example.com/jobs/900001',jd:'Software internship.'},{id:'test',name:'Synthetic'});
 s.saveCatalogue({jobs:[publicJob],sources:[{id:'test',status:'complete'}],finishedAt:new Date(s.now()).toISOString()});assert.equal(s.opportunities(a).length,1);assert.equal(s.pendingOpportunities(a).length,0);assert.equal(s.pendingOpportunities(b).length,1);
});
test('portal preserves employer date/material and known school dates without duplicate confirmations',t=>{
 const{s,a}=setup(t);s.syncSchoolOpportunities(a,paste('900001',''));const item=s.schoolOpportunities(a)[0],job=s.startSchoolOpportunity(a,item.schoolId,item.fingerprint);
 s.confirmSubmission(a,job.id,{source:'manual-confirmation',confirmed:true,channel:'employer',date:'2026-10-01',receipt:'Employer receipt',requestId:randomUUID()});
 s.confirmSubmission(a,job.id,{source:'manual-confirmation',confirmed:true,channel:'school',date:'2026-10-02',receipt:'School receipt',schoolRevision:s.schoolContext(a,job.id).revision,requestId:randomUUID()});
 const before=s.application(a,job.id).submissions;const result=s.syncSchoolOpportunities(a,paste());assert.equal(result.submissions.added,0);assert.equal(result.submissions.existing,1);const after=s.application(a,job.id).submissions;assert.equal(after.length,2);for(const row of before){const next=after.find(n=>n.id===row.id);assert.equal(next.date,row.date);assert.equal(next.receipt,row.receipt);}assert.ok(after.find(row=>row.channel==='school').portalEvidence);
});
test('portal local correction and withdrawal remain auditable and repeated portal imports cannot undo withdrawal',t=>{
 const{s,a}=setup(t);s.syncSchoolOpportunities(a,paste());const app=s.applications(a)[0],record=app.submissions[0];const change=(action,extra={})=>s.changeConfirmation(a,app.jobId,record.id,{action,revision:s.confirmations(a,app.jobId,true)[0].revision,confirmed:true,requestId:randomUUID(),schoolRevision:s.schoolContext(a,app.jobId).revision,date:'',receipt:'Portal evidence',...extra});
 change('correct',{date:'2026-10-01'});assert.equal(s.applications(a)[0].submissions[0].date,'2026-10-01');change('correct');assert.equal(s.applications(a)[0].submissions[0].date,'');change('withdraw');assert.equal(s.applications(a).length,0);assert.equal(s.pendingSchoolOpportunities(a).length,1);s.syncSchoolOpportunities(a,paste());assert.equal(s.applications(a).length,0);change('restore');assert.equal(s.applications(a)[0].submissions[0].date,'');assert.equal(s.confirmations(a,app.jobId)[0].corrections.length,4);
});
test('portal import rolls back all school jobs, observations and confirmations on failure',t=>{
 const{s,a}=setup(t);s.db.exec("CREATE TRIGGER fail_portal BEFORE INSERT ON portal_submission_observations BEGIN SELECT RAISE(ABORT,'Synthetic failure'); END");assert.throws(()=>s.syncSchoolOpportunities(a,paste()),/Synthetic failure/);assert.equal(s.jobs(a).length,0);assert.equal(s.schoolOpportunities(a).length,0);assert.equal(s.applications(a).length,0);
});
test('portal restart and export preserve original source and actual date unknown',t=>{
 const{s,a,database}=setup(t);s.syncSchoolOpportunities(a,paste());const after=new WorkspaceStore(database);try{assert.equal(after.pendingOpportunities(a).length,0);assert.equal(after.applications(a)[0].submissions[0].date,'');assert.equal(after.exportData(a).portalSubmissionObservations.length,1);}finally{after.close();}
});

test('portal legacy explicit import applies the same submitted rule atomically and remains retry-safe',t=>{
 const {s,a}=setup(t),text=paste();const input={text,fingerprint:s.schoolPreview(a,text).fingerprint,selections:[{index:0,target:'new'}],confirmed:true,requestId:randomUUID()};
 const first=s.importSchool(a,input);assert.equal(first.submissions.added,1);assert.deepEqual(s.importSchool(a,input),first);assert.equal(s.applications(a).length,1);assert.equal(s.pendingSchoolOpportunities(a).length,0);assert.equal(s.pendingOpportunities(a).length,0);
});
test('submitted identities match application rows through portal confirmation, withdrawal and restore',t=>{
 const{s,a,b}=setup(t);const same=owner=>assert.deepEqual(s.submittedIdentities(owner).jobIds,new Set(s.applications(owner).map(row=>row.jobId)));
 s.syncSchoolOpportunities(a,paste());same(a);same(b);const app=s.applications(a)[0],record=app.submissions[0];assert.ok(s.submittedIdentities(a).jobIds.has(app.jobId));
 const change=action=>s.changeConfirmation(a,app.jobId,record.id,{action,revision:s.confirmations(a,app.jobId,true)[0].revision,confirmed:true,requestId:randomUUID(),schoolRevision:s.schoolContext(a,app.jobId).revision,date:'',receipt:'Portal evidence'});
 change('withdraw');same(a);assert.ok(!s.submittedIdentities(a).jobIds.has(app.jobId));change('restore');same(a);assert.ok(s.submittedIdentities(a).jobIds.has(app.jobId));
});
test('applications() equals the per-job derivation for submitted, withdrawn and unsubmitted jobs',t=>{
 const{s,a,b}=setup(t);const legacy=owner=>s.jobs(owner).flatMap(job=>{const app=s.application(owner,job.id);return app.submissions.length?[{jobId:job.id,company:job.company,title:job.title,status:app.status,channel:app.channel,requirement:app.requirement,channelProgress:app.channelProgress,schoolContext:s.schoolContext(owner,job.id),submissions:app.submissions}]:[];});
 s.syncSchoolOpportunities(a,paste());s.syncSchoolOpportunities(a,paste('900002','Shortlist'));const item=s.schoolOpportunities(a).find(row=>!s.submittedJobIds(a).has(row.jobId));if(item)s.startSchoolOpportunity(a,item.schoolId,item.fingerprint);s.saveJob(a,{company:'Synthetic Other',title:'Intern',jd:'Python'});
 assert.deepEqual(s.applications(a),legacy(a));assert.equal(s.applications(a).length,1);assert.deepEqual(s.applications(b),legacy(b));
 const app=s.applications(a)[0],record=app.submissions[0];s.changeConfirmation(a,app.jobId,record.id,{action:'withdraw',revision:s.confirmations(a,app.jobId,true)[0].revision,confirmed:true,requestId:randomUUID(),schoolRevision:s.schoolContext(a,app.jobId).revision,date:'',receipt:'Portal evidence'});
 assert.deepEqual(s.applications(a),legacy(a));assert.equal(s.applications(a).length,0);
});
test('portal submitted row outside the account scope is still recorded and does not abort the batch',t=>{
 const{s,a}=setup(t);s.db.prepare('UPDATE users SET preferences=? WHERE id=?').run(JSON.stringify({opportunityScope:'canada-or-remote'}),a);
 const text=paste('900001').replace('|Toronto|','|London, UK|')+'\n'+paste('900002','').split('\n')[2];
 const result=s.syncSchoolOpportunities(a,text);assert.equal(result.updated,2);assert.equal(result.submissions.added,1);
 assert.equal(s.schoolOpportunities(a).length,2);assert.equal(s.applications(a)[0].submissions[0].channel,'school');assert.deepEqual(s.pendingSchoolOpportunities(a).map(item=>item.schoolId),['900002']);
 assert.throws(()=>{s.syncSchoolOpportunities(a,paste('900003','').replace('|Toronto|','|London, UK|'));const item=s.schoolOpportunities(a).find(row=>row.schoolId==='900003');s.startSchoolOpportunity(a,item.schoolId,item.fingerprint);},/资格条件排除/);
});
test('portal import failure names the school row that stopped the batch',t=>{
 const{s,a}=setup(t);s.startSchoolOpportunity=()=>{throw Object.assign(new Error('Synthetic conflict'),{status:409});};
 assert.throws(()=>s.syncSchoolOpportunities(a,paste()),error=>error.status===409&&/^学校 ID 900001（Example Labs · Software Intern）：Synthetic conflict。本批未写入/.test(error.message));assert.equal(s.schoolOpportunities(a).length,0);
});
test('portal auto-link records its own reason and stays a non-explicit match',t=>{
 const{s,a}=setup(t);s.syncSchoolOpportunities(a,paste());s.syncSchoolOpportunities(a,paste('900002',''));const item=s.schoolOpportunities(a).find(row=>row.schoolId==='900002');s.startSchoolOpportunity(a,item.schoolId,item.fingerprint);
 const reasons=Object.fromEntries(s.schoolHistory(a).filter(e=>e.action==='link').map(e=>[e.schoolId,e.reason]));assert.equal(reasons['900001'],'学校 Portal 显示已提交，自动建立关联');assert.equal(reasons['900002'],'本人从学校职位开始准备');
 for(const row of s.schoolOpportunities(a))assert.equal(row.explicitMatch,false);
});
