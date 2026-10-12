export function schoolTrialController({execute,scanFunction,openFunction,detailFunction,store={load:async()=>null,save:async()=>{}},getTab=async()=>null,relatedTabs=async()=>[],delay=ms=>new Promise(r=>setTimeout(r,ms)),now=()=>Date.now(),newId=()=>crypto.randomUUID()}){
 let state={version:2,phase:'idle'},running=false,paused=false,epoch=0;
 const terminal=new Set(['idle','cancelled','expired','captured','identity-review']);
 const snapshot=()=>({phase:state.phase,schoolId:state.entry?.schoolId||null,code:state.code||null,clickState:state.clickState||'none',hasPacket:Boolean(state.entry),paused,running,canContinue:Boolean(state.entry)&&!running&&!['captured','identity-review','expired','cancelled'].includes(state.phase),canRestart:Boolean(state.entry)&&!running,diagnostics:state.diagnostics||{}});
 const save=()=>store.save({...state,paused,updatedAt:now()});
 const ready=(async()=>{const saved=await store.load();if(![1,2].includes(saved?.version))return;
  state=saved;paused=Boolean(saved.paused);
  if(now()-saved.updatedAt>86400000){state={version:2,phase:'expired',code:'TRIAL_EXPIRED'};await save();return;}
  const legacy=saved.version===1;state.version=2;
  if(!terminal.has(state.phase)&&state.phase!=='stopped'){state.phase=state.entry?'recovery-required':'stopped';state.clickState=state.clickState||'unknown';state.code=legacy?'LEGACY_CLICK_OUTCOME_UNKNOWN':'RECOVERY_CHECK_REQUIRED';await save();}
 })();
 async function read(tabId,fn,args){let timer;try{const result=await Promise.race([execute(tabId,fn,args),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('INJECTION_RESPONSE_TIMEOUT')),8000);})]);const frame=result?.find(x=>x.frameId===0);if(!frame?.result||frame.error)throw Error('INJECTION_FAILED');return frame.result;}finally{clearTimeout(timer);}}
 const injectionCode=e=>/permission|cannot access|not allowed|host access/i.test(e?.message||'')?'DETAIL_TAB_ACCESS_REQUIRED':e?.message==='INJECTION_RESPONSE_TIMEOUT'?'INJECTION_RESPONSE_TIMEOUT':'DETAIL_INJECTION_FAILED';
 async function stop(code){state.phase='stopped';state.code=code;await save();return snapshot();}
 async function inspect(){
  if(!state.entry)return snapshot();
  let related;try{related=(await relatedTabs(state.listTabId)).filter(t=>Number.isInteger(t.id)&&t.openerTabId===state.listTabId);}catch{return stop('TAB_CHECK_UNAVAILABLE');}
  const candidates=related.filter(t=>!(state.baselineTabIds||[]).includes(t.id));
  state.diagnostics={...state.diagnostics,relatedTabCount:candidates.length};
  let receipt;try{receipt=await read(state.listTabId,scanFunction,['receipt']);}catch{state.diagnostics.receiptUnavailable=true;}
  if(receipt?.receipt?.attemptId===state.attemptId&&state.attemptId&&receipt.receipt.clickDispatched)state.clickState='dispatched';
  state.diagnostics.listStillVisible=receipt?.listVisible===true;
  state.phase=candidates.length?'tab-observed':'recovery-required';
  state.code=candidates.length?'RELATED_TAB_REQUIRES_IDENTITY_CHECK':state.clickState==='dispatched'?'NO_DETAIL_TAB_OBSERVED':'CLICK_OUTCOME_NOT_CONFIRMED';
  await save();return snapshot();
 }
 async function drive(){if(running)return snapshot();running=true;const started=now(),run=epoch;
  try{while(run===epoch&&state.phase==='waiting'&&!paused){
   if(now()-started>45000)return await stop('DETAIL_LOAD_TIMEOUT');
   let detail;try{detail=await read(state.detailTabId,detailFunction,[state.entry,{requireVerified:true}]);}catch(e){if(run!==epoch)break;return await stop(injectionCode(e));}
   if(run!==epoch||paused)break;
   if(detail.ok&&detail.schema==='career-queue-school-visible-detail-v1'){
    if(!detail.identity?.verified)return await stop('DETAIL_IDENTITY_CHANGED_OR_INCOMPLETE');
    if(state.verifiedBinding)detail.identity.basis=state.verifiedBinding;
    state.packet={schema:'career-queue-school-read-trial-v1',entry:state.entry,detail,automaticReturn:false};state.phase=detail.identity?.verified?'captured':'identity-review';state.code=detail.identity?.verified?null:'DETAIL_IDENTITY_NOT_VERIFIED';await save();break;
   }
   state.diagnostics={...state.diagnostics,fieldCount:detail.fieldCount||0,recognizedLabels:detail.recognizedLabels||[],frames:detail.frames||null,lastReadCode:detail.code||'DETAIL_READ_FAILED'};
   if(detail.code!=='WAITING_FOR_DETAIL')return await stop(detail.code||'DETAIL_READ_FAILED');
   await save();await delay(500);
  }}catch{state.phase='stopped';state.code='LOCAL_STATE_UNAVAILABLE';}finally{running=false;}return snapshot();
 }
 async function start(tabId,schoolId='',allowCancelled=false){
  await ready;if(running)throw Error('TRIAL_ALREADY_ACTIVE');if(!Number.isInteger(tabId)||schoolId&&!/^\d{4,10}$/.test(schoolId))throw Error('INVALID_TARGET');
  if(state.entry&&(!terminal.has(state.phase)||state.phase==='cancelled'&&!allowCancelled))return inspect();
  running=true;paused=false;const run=++epoch;state={version:2,phase:'scanning',listTabId:tabId};
  try{const scan=await read(tabId,scanFunction,['scan']);if(!scan.ok)return await stop(scan.code||'LIST_SCAN_FAILED');const entries=scan.entries||[],selected=schoolId?entries.filter(e=>e.schoolId===schoolId):entries.slice(0,1);
   if(selected.length!==1||selected[0].candidateCount!==1||entries.filter(e=>e.title===selected[0].title&&e.company===selected[0].company&&e.term===selected[0].term).length!==1)return await stop('TITLE_TARGET_NOT_UNIQUE');
   if(run!==epoch)return snapshot();const e=selected[0];state.entry={schoolId:e.schoolId,title:e.title,company:e.company,term:e.term,candidateCount:1};state.baselineTabIds=(await relatedTabs(tabId)).map(t=>t.id);if(run!==epoch)return snapshot();state.attemptId=newId();state.phase='click-intent';state.clickState='intent';state.code='CLICK_NOT_YET_CONFIRMED';await save();if(run!==epoch)return snapshot();
   try{const opened=await read(tabId,openFunction,['open',{...state.entry,attemptId:state.attemptId}]);if(run!==epoch)return snapshot();if(opened?.ok===false)return await stop(opened.code||'TITLE_OPEN_FAILED');state.clickState='dispatched';state.phase='click-dispatched';state.code='TITLE_CLICK_DISPATCHED';await save();}
   catch{if(run!==epoch)return snapshot();state.phase='recovery-required';state.code='CLICK_OUTCOME_NOT_CONFIRMED';state.diagnostics={...state.diagnostics,navigationResponseLost:true};await save();}
   return await inspect();
  }catch(e){state.phase='stopped';state.code=e?.message==='LOCAL_STATE_UNAVAILABLE'?'LOCAL_STATE_UNAVAILABLE':'LIST_SCAN_FAILED';}
  finally{running=false;}return snapshot();
 }
 return {ready,status:snapshot,packet:()=>state.packet?structuredClone(state.packet):state.entry?{schema:'career-queue-school-read-trial-diagnostic-v1',entry:state.entry,phase:state.phase,clickState:state.clickState||'unknown',code:state.code,diagnostics:state.diagnostics||{},automaticReturn:false}:null,
  async observeTab(tab){await ready;if(!state.entry||terminal.has(state.phase)||tab.openerTabId!==state.listTabId||!Number.isInteger(tab.id))return;state.observedDetailTabId=tab.id;state.diagnostics={...state.diagnostics,newTabObserved:true};await save();},
  async check(){await ready;if(running)return snapshot();if(terminal.has(state.phase))return snapshot();return inspect();},
  async cancel(){await ready;epoch++;paused=false;state.phase='cancelled';state.code='TRIAL_CANCELLED_NO_TAB_CLOSED';await save();return snapshot();},
  async restart(tabId,schoolId='',confirmedNoDetail=false){await ready;if(running)throw Error('TRIAL_ALREADY_ACTIVE');if(!confirmedNoDetail)throw Error('RESTART_CONFIRMATION_REQUIRED');if(state.entry){await inspect();if(state.diagnostics?.relatedTabCount||state.code==='TAB_CHECK_UNAVAILABLE')return snapshot();if(!state.diagnostics?.listStillVisible){let current;try{current=await read(tabId,scanFunction,['receipt']);}catch{}if(!current?.listVisible)return stop('VERIFY_ORIGINAL_LIST_BEFORE_RESTART');}}state.phase='cancelled';await save();return start(tabId,schoolId,true);},
  async pause(){await ready;paused=true;await save();return snapshot();},
  async resume(){await ready;if(state.phase!=='waiting')return snapshot();paused=false;await save();void drive();return snapshot();},
  async continueInTab(tabId){await ready;if(running)throw Error('TRIAL_ALREADY_ACTIVE');if(!state.entry||!Number.isInteger(tabId)||state.phase==='cancelled')throw Error('NO_TRIAL_TO_CONTINUE');
   if(['captured','identity-review'].includes(state.phase))return snapshot();
   running=true;const run=epoch;let tab,probe;
   try{tab=await getTab(tabId);if(tab&&tab.id!==tabId)throw Error('INVALID_TARGET');let sourceExists=false;try{sourceExists=Boolean(await getTab(state.listTabId));}catch{}
    state.diagnostics={...state.diagnostics,openerPresent:Number.isInteger(tab?.openerTabId),openerMatches:tab?.openerTabId===state.listTabId,sourceExists,explicitCurrentTab:true,rebindVerified:false};
    probe=await read(tabId,detailFunction,[state.entry,{identityOnly:true}]);if(run!==epoch)return snapshot();
    if(!probe.ok||probe.schema!=='career-queue-school-identity-v1'||probe.verified!==true){state.diagnostics.identityChecks=probe.checks||{};return await stop(probe.code||'DETAIL_IDENTITY_INCOMPLETE');}
    state.verifiedBinding=probe.identity.basis;state.diagnostics.rebindVerified=true;
   }catch(e){if(run===epoch)return await stop(injectionCode(e));return snapshot();}finally{running=false;}
   state.detailTabId=tabId;state.phase='waiting';state.code=null;paused=false;state.diagnostics={...state.diagnostics,binding:tabId===state.listTabId?'explicit-original-tab':tab?.openerTabId===state.listTabId?'explicit-opener-child':'explicit-current-tab-identity-required'};
   await save();void drive();return snapshot();
  },start
 };
}
