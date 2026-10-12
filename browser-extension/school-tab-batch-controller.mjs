import{observeSchoolDetail}from'./school-detail-observer.mjs';
export const SCHOOL_ORIGIN='https://recruitstudents.torontomu.ca/*';
export function coversSchoolOrigin(pattern){
 if(pattern==='<all_urls>')return true;
 const m=/^(https|\*):\/\/([^/]+)\/\*$/.exec(pattern||'');if(!m)return false;
 const host='recruitstudents.torontomu.ca';return m[2]==='*'||m[2]===host||m[2].startsWith('*.')&&(host===m[2].slice(2)||host.endsWith(m[2].slice(1)));
}
export function schoolTabBatchController(a){
 let s={stateVersion:3,phase:'idle',jobs:[]},running=false,epoch=0,beginWrite;
 const save=()=>a.store.save(structuredClone(s));
 const status=()=>structuredClone(s);
 const unresolved=()=>!!s.attempt&&s.attempt.schoolId===s.entries?.[s.next||0]?.schoolId;
 const blocked=()=>s.requiresNewAttemptReview===true||s.phase==='failed'&&unresolved()||s.phase==='reviewed';
 const archive=()=>{const {archives,...snapshot}=structuredClone(s);return[...(archives||[]),{archivedAt:new Date().toISOString(),snapshot}];};
 async function audit(){await ready;const result={checkedAt:new Date().toISOString(),persistent:null,exact:null};try{result.persistent=await bounded(persistentPermission());result.exact=await bounded(a.hasExactPermission());}catch{result.error='PERMISSION_AUDIT_UNAVAILABLE';}return{...status(),permissionAudit:result};}

 const persistentPermission=()=>a.hasPersistentPermission?a.hasPersistentPermission():a.hasPermission();
 const note=(event,data={})=>{s.events=[...(s.events||[]),{event,at:new Date().toISOString(),...data}].slice(-40);};
 const promptAlive=async()=>{try{return !!s.permissionRequest?.documentId&&!!await a.popupAlive?.(s.permissionRequest.documentId);}catch{return false;}};
 const bounded=p=>new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('OPERATION_TIMEOUT')),15000);t.unref?.();Promise.resolve(p).then(resolve,reject).finally(()=>clearTimeout(t));});
 async function cleanup(phase,code){
  if(!s.preexisting&&s.requestIntent&&!s.owned){try{if(await bounded(a.hasExactPermission()))s.owned=true;}catch{s.phase='cleanup-required';s.code='PERMISSION_STATE_UNAVAILABLE';try{await save();}catch{}return status();}}
  if((phase==='failed'||s.phase==='failed')&&unresolved())s.requiresNewAttemptReview=true;s.phase=phase;s.code=code||null;note('cleanup-start',{phase,owned:!!s.owned,preexisting:!!s.preexisting});let storageFailed=false;try{await save();}catch{storageFailed=true;}
  if(s.owned){try{await bounded(a.removePermission());if(await bounded(a.hasExactPermission()))throw Error();s.owned=false;s.pendingPermission=false;s.permissionCleanup={requestId:s.permissionRequest?.id||null,at:new Date().toISOString(),result:'revoked',exactPermissionPresent:false};note('new-grant-revoked',{requestId:s.permissionRequest?.id||null,exactPermissionPresent:false});}catch{s.phase='cleanup-required';s.code='PERMISSION_REVOKE_FAILED';note('revoke-failed');}}
  else if(s.preexisting){s.permissionCleanup={requestId:s.permissionRequest?.id||null,at:new Date().toISOString(),result:'preexisting-preserved'};note('preexisting-grant-preserved');}
  if(!s.pendingPermission&&!s.owned)s.requestIntent=false;
  try{await save();}catch{storageFailed=true;}if(storageFailed&&!s.owned){s.phase='failed';s.code='LOCAL_STATE_UNAVAILABLE';}return status();
 }
 const ready=(async()=>{const old=await a.store.load();if(old)s=old;s.stateVersion=3;
  if(['prepared','armed'].includes(s.phase)&&!s.owned&&!s.pendingPermission){if(s.phase==='armed'&&!s.permissionRequest)s.permissionRequest={id:a.uuid(),settled:false};note('prepared-state-restored',{phase:s.phase});await save();return;}
  if(s.phase==='requesting'&&await promptAlive()){note('active-permission-prompt-restored');await save();return;}
  if(!s.preexisting&&s.requestIntent&&await a.hasExactPermission())s.owned=true;
  if(['requesting','running','pausing'].includes(s.phase)||s.owned||s.pendingPermission){
  const previous=s.phase;s.pendingPermission=false;note('execution-interrupted',{previousPhase:previous,completedIds:(s.jobs||[]).map(j=>j.entry.schoolId),attemptStage:s.attempt?.stage||null});
  await cleanup('interrupted',previous==='requesting'?'AUTHORIZATION_WINDOW_CLOSED':'WORKER_RESTARTED_REVIEW');
 }})();
 async function prepare(tabId){await ready;if(running||s.owned||s.pendingPermission||s.phase==='cleanup-required')throw Error('BATCH_BUSY_OR_CLEANUP_REQUIRED');if(s.entries?.length&&s.phase!=='completed'&&s.phase!=='idle')throw Error('EXISTING_BATCH_REQUIRES_REVIEW');
  const result=await bounded(a.scan(tabId));if(!result?.ok)throw Error(result?.code||'LIST_UNAVAILABLE');
  const entries=(result.entries||[]).filter(e=>e.candidateCount===1&&/^\d{4,10}$/.test(e.schoolId));
  if(entries.length<2||new Set(entries.map(e=>e.schoolId)).size!==entries.length)throw Error('TWO_UNIQUE_JOBS_REQUIRED');
  const archives=s.id?archive():s.archives||[];s={archives,stateVersion:3,id:a.uuid(),phase:'prepared',listTabId:tabId,entries:entries.slice(0,2),jobs:[],next:0,preexisting:await persistentPermission(),owned:false,requestIntent:false};note('batch-prepared');await save();return status();
 }
 async function reprepare(tabId){await ready;
  if(running||s.owned||s.pendingPermission||!['failed','interrupted','cancelled','denied','paused'].includes(s.phase)||!s.entries?.length)throw Error('REPREPARE_NOT_AVAILABLE');
  if(s.next>=s.entries.length)throw Error('BATCH_ALREADY_CAPTURED');
  if(tabId!==s.listTabId)throw Error('ORIGINAL_LIST_REQUIRED');
  const list=await bounded(a.scan(tabId));if(!list?.ok)throw Error(list?.code||'LIST_UNAVAILABLE');
  for(const e of s.entries.slice(s.next||0)){const matches=(list.entries||[]).filter(x=>x.schoolId===e.schoolId);if(matches.length!==1||matches[0].candidateCount!==1||['title','company','term'].some(k=>matches[0][k]!==e[k]))throw Error('ORIGINAL_PLAN_CHANGED');}
  const previousState=structuredClone(s);const archives=archive();const previousId=s.id;s={stateVersion:3,id:a.uuid(),phase:'reviewed',code:'NEW_ATTEMPT_NOT_STARTED',listTabId:tabId,entries:s.entries,jobs:s.jobs,next:s.next||0,archives,previousId,preexisting:await persistentPermission(),owned:false,pendingPermission:false,requestIntent:false,requiresNewAttemptConfirmation:true};
  note('read-only-reprepared',{previousId});try{await save();}catch(error){s=previousState;throw error;}return status();
 }
 async function arm(confirmNewAttempt=false){await ready;if(blocked()&&!(s.phase==='reviewed'&&confirmNewAttempt===true))throw Error('NEW_ATTEMPT_REVIEW_REQUIRED');if(s.phase==='armed')return status();if(!['prepared','paused','interrupted','denied','reviewed'].includes(s.phase)||!s.entries||s.owned||s.pendingPermission)throw Error('PREPARE_REQUIRED');
  if(s.phase==='reviewed'){s.requiresNewAttemptConfirmation=false;s.newAttemptConfirmed=true;note('new-attempt-explicitly-confirmed');}
  if(s.next===s.entries.length&&s.jobs.length===s.entries.length)return cleanup('completed');
  s.preexisting=await persistentPermission();s.permissionCleanup=null;s.execution=null;s.permissionRequest={id:a.uuid(),settled:false,requestInvoked:false,outcome:'not-reported',preexistingAtArm:s.preexisting};s.requestIntent=false;s.pendingPermission=false;s.pauseRequested=false;s.phase='armed';s.code=null;note('permission-armed',{preexisting:s.preexisting});await save();return status();
 }
 async function begin(id,documentId=null,requestId=s.permissionRequest?.id){await ready;if(id!==s.id||requestId!==s.permissionRequest?.id||!requestId)throw Error('PREPARE_REQUIRED');
  if(s.phase==='requesting'&&s.permissionRequest.documentId===documentId){await beginWrite;return status();}
  if(s.phase!=='armed')throw Error('PREPARE_REQUIRED');s.permissionRequest.documentId=documentId;s.permissionRequest.requestInvoked=null;s.phase='requesting';s.requestIntent=true;s.pendingPermission=true;s.execution={id:requestId,kind:unresolved()?'inspect-existing':s.newAttemptConfirmed?'explicit-new':'initial',openInvokedThisRun:false};note('permission-begin-recorded',{requestId});beginWrite=save();try{await beginWrite;}finally{beginWrite=null;}return status();}
 async function granted(id,accepted,requestId=s.permissionRequest?.id,documentId=null,requestReport=null){await ready;await beginWrite;if(id!==s.id||requestId!==s.permissionRequest?.id||!requestId)throw Error('STALE_PERMISSION_REPLY');
  if(s.permissionRequest.documentId&&s.permissionRequest.documentId!==documentId)throw Error('STALE_AUTHORIZATION_WINDOW');
  if(s.permissionRequest.settled)return status();s.permissionRequest.settled=true;s.permissionRequest.requestInvoked=requestReport?.invoked===true?true:null;s.permissionRequest.outcome=['accepted','rejected','error'].includes(requestReport?.outcome)?requestReport.outcome:(accepted?'accepted-legacy':'rejected-legacy');s.permissionRequest.promptShown='unknown';note('permission-result',{requestId,accepted:!!accepted,requestInvoked:s.permissionRequest.requestInvoked,outcome:s.permissionRequest.outcome});
  if(!s.preexisting&&(s.requestIntent||s.phase==='armed')&&await a.hasExactPermission())s.owned=true;
  s.pendingPermission=false;
  if(s.phase!=='requesting')return cleanup('cancelled','LATE_PERMISSION_RESULT');
  if(requestReport?.outcome==='error')return cleanup('failed','PERMISSION_REQUEST_ERROR');if(!accepted||!await a.hasPermission())return cleanup('denied','PERMISSION_DENIED');
  s.phase='running';try{await save();}catch{return cleanup('failed','LOCAL_STATE_UNAVAILABLE');}void run();return status();
 }
 async function run(){if(running)return;running=true;const token=++epoch;
  const live=()=>{if(token!==epoch)throw Error('CANCELLED');};
  const call=async p=>{const r=await bounded(p);live();return r;};
  try{while(s.next<s.entries.length){
   if(s.pauseRequested){await cleanup('paused');return;}
   if(!await call(a.hasPermission()))throw Error('PERMISSION_LOST');
   await call(a.getTab(s.listTabId));const e=s.entries[s.next];
   const recovering=s.attempt?.schoolId===e.schoolId;
   const baseline=new Set(recovering?s.attempt.baseline:(await call(a.tabs())).map(t=>t.id));
   if(recovering){
    note('existing-attempt-recovery',{schoolId:e.schoolId});
    const receipt=await call(a.receipt?.(s.listTabId));s.attempt.receiptPresent=receipt?.receipt?.attemptId===s.attempt.id;
   }else{
    s.attempt={id:a.uuid(),createdRunId:s.execution?.id||null,schoolId:e.schoolId,baseline:[...baseline],eventMark:a.markTabEvents?.(),stage:'intent'};await save();live();
    if(s.execution)s.execution.openInvokedThisRun=true;note('title-dispatch-invoked',{attemptId:s.attempt.id,requestId:s.permissionRequest?.id||null});let opened;try{opened=await call(a.open(s.listTabId,{...e,attemptId:s.attempt.id}));}catch{live();s.attempt.stage='click-outcome-unknown';}
    if(opened&&!opened.ok)throw Error(opened.code||'TITLE_CLICK_FAILED');
    if(opened?.ok){s.attempt.stage='dispatched';s.attempt.clickEvidence=opened.clickEvidence||null;}await save();live();
   }
   const observed=await observeSchoolDetail({tabs:()=>call(a.tabs()),tabEvents:mark=>call(Promise.resolve(a.tabEvents?.(mark)||[])),getTab:id=>call(a.getTab(id)),scan:id=>call(a.scan(id)),read:(id,e,o)=>call(a.read(id,e,o)),delay:ms=>call(a.delay(ms))},s.attempt,s.listTabId,e,{recovering});live();
   const child=observed.tab;s.attempt.childId=child.id;s.attempt.mode=observed.mode;s.attempt.closeOwned=observed.closeOwned;s.attempt.stage='detail-observed';await save();live();
   let detail;
   for(let tries=0;tries<20;tries++){
    await call(a.getTab(s.listTabId));const tab=await call(a.getTab(child.id));
    if(observed.closeOwned&&tab.openerTabId!==s.listTabId)throw Error('DETAIL_TAB_OWNERSHIP_CHANGED');
    if(tab.status==='loading'){await call(a.delay(500));continue;}
    const u=new URL(tab.url||'');if(u.origin!=='https://recruitstudents.torontomu.ca'||u.pathname!=='/myAccount/coop/postings.htm')throw Error('PORTAL_CHANGED');
    const identity=await call(a.read(child.id,e,{identityOnly:true}));
    if(!identity?.ok)throw Error(identity?.code||'DETAIL_IDENTITY_FAILED');
    if(identity.verified!==true)throw Error('DETAIL_IDENTITY_FAILED');
    detail=await call(a.read(child.id,e,{requireVerified:true}));break;
   }
   if(!detail?.ok||!detail.identity?.verified||detail.capture?.completeWithinScope!==true||detail.capture?.truncated!==false||detail.capture?.hiddenOrCollapsedRead!==false||!detail.jd)throw Error(detail?.code||'DETAIL_INCOMPLETE');
   s.jobs.push({entry:e,detail});s.next++;s.attempt.stage='captured';note('job-captured',{schoolId:e.schoolId});await save();live();
   if(observed.mode==='same-tab'){s.pauseRequested=true;await cleanup('paused','SAME_TAB_DETAIL_CAPTURED_RETURN_MANUALLY');return;}
   // Recheck ownership, identity and source immediately before closing only our verified child.
   await call(a.getTab(s.listTabId));const current=await call(a.getTab(child.id));
   if(observed.closeOwned&&(current.openerTabId!==s.listTabId||baseline.has(child.id)))throw Error('DETAIL_TAB_OWNERSHIP_CHANGED');
   const finalIdentity=await call(a.read(child.id,e,{identityOnly:true}));if(!finalIdentity?.ok||finalIdentity.verified!==true)throw Error('DETAIL_CHANGED_BEFORE_CLOSE');
   if(observed.closeOwned){await call(a.closeTab(child.id));s.attempt.stage='closed';}else{s.attempt.stage='preserved';note('detail-tab-preserved',{mode:observed.mode});}await save();live();await call(a.activate(s.listTabId));
   const list=await call(a.scan(s.listTabId));if(!list?.ok||!list.entries?.length)throw Error('LIST_RETURN_NOT_VERIFIED');
   if(s.next<s.entries.length)await call(a.delay(2000));
  }await cleanup('completed');
  }catch(error){if(token===epoch)await cleanup('failed',/^[A-Z][A-Z0-9_]{0,70}$/.test(error.message||'')?error.message:'BATCH_OPERATION_FAILED');}finally{running=false;}
 }
 return{ready,status,audit,prepare,reprepare,arm,begin,granted,
  async pause(){await ready;if(blocked())return status();s.pauseRequested=true;await save();if(!running)return cleanup('paused');return status();},
  async cancel(){await ready;++epoch;return cleanup('cancelled');},
  async retryCleanup(){await ready;return cleanup('cancelled');},
  diagnostic(){return{schema:'career-queue-school-batch-diagnostic-v1',extensionVersion:'0.2.5',batchId:s.id||null,phase:s.phase,code:s.code||null,execution:s.execution||null,permissionRequest:s.permissionRequest||null,permissionCleanup:s.permissionCleanup||null,archives:(s.archives||[]).map(({archivedAt,snapshot:x})=>({archivedAt,snapshot:{id:x.id,phase:x.phase,code:x.code||null,entries:x.entries,completedIds:(x.jobs||[]).map(j=>j.entry.schoolId),next:x.next,attempt:x.attempt||null,execution:x.execution||null,permissionRequest:x.permissionRequest||null,permissionCleanup:x.permissionCleanup||null,preexisting:!!x.preexisting,owned:!!x.owned,events:x.events||[]}})),requiresNewAttemptReview:blocked(),planned:(s.entries||[]).map(({schoolId,title,company,term})=>({schoolId,title,company,term})),completedIds:(s.jobs||[]).map(j=>j.entry.schoolId),next:s.next||0,attempt:s.attempt?{id:s.attempt.id,createdRunId:s.attempt.createdRunId||null,schoolId:s.attempt.schoolId,stage:s.attempt.stage||'legacy-unknown',childObserved:!!s.attempt.childId,mode:s.attempt.mode||null,clickEvidence:s.attempt.clickEvidence||null,observation:s.attempt.observation||null}:null,permission:{preexisting:!!s.preexisting,owned:!!s.owned,pending:!!s.pendingPermission,resultReceived:!!s.permissionRequest?.settled,scope:'batch grant records; not a live audit of all site permissions'},events:s.events||[],automaticReplay:false};},
  packet(){return{schema:'career-queue-school-capture-v1',jobs:s.jobs.map(({entry:e,detail:d})=>({schoolId:e.schoolId,url:d.origin+d.page.path,title:e.title,company:e.company,status:'done',jd:d.jd,duration:d.duration,applicationInstructions:d.applicationInstructions||'',capturedAt:d.capturedAt}))};}
 };
}
