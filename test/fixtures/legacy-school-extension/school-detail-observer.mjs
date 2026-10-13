export function schoolJobTab(tab){try{const u=new URL(tab?.url||'');return u.origin==='https://recruitstudents.torontomu.ca'&&u.pathname==='/myAccount/coop/postings.htm';}catch{return false;}}
// Metadata-only observation. Ownership for closing is stricter than permission to read.
export async function observeSchoolDetail(a,attempt,listTabId,expected,{recovering=false,rounds=16}={}){
 const baseline=new Set(attempt.baseline||[]),evidence=attempt.observation={mode:null,newRelated:0,newUnlinked:0,reused:0,sourceChanged:false,closedRelated:false,identityRejected:0};
 let lastCode,seenAny=false;const candidateKinds=new Map();
 for(let round=0;round<rounds;round++){
  const tabs=await a.tabs(),events=await a.tabEvents?.(attempt.eventMark)||[],changed=new Set(events.filter(e=>['updated','activated'].includes(e.kind)).map(e=>e.id));
  const liveIds=new Set(tabs.map(t=>t.id));evidence.closedRelated=events.some(e=>e.kind==='created'&&e.openerTabId===listTabId&&!liveIds.has(e.id));
  const sourceTab=await a.getTab(listTabId);if(sourceTab.status==='loading'){seenAny=true;evidence.sourceLoading=true;}const source=sourceTab.status==='loading'?{ok:true,entries:[{}]}:await a.scan(listTabId);if(!source?.ok)throw Error(source?.code||'SOURCE_PAGE_UNAVAILABLE');
  const matches=[];
  if(!source.entries?.length){evidence.sourceChanged=true;const identity=await a.read(listTabId,expected,{identityOnly:true});if(identity?.ok&&identity.verified)matches.push({tab:await a.getTab(listTabId),mode:'same-tab',closeOwned:false});else lastCode=identity?.code||'SOURCE_IDENTITY_UNVERIFIED';}
  const candidates=tabs.filter(t=>t.id!==listTabId&&(!baseline.has(t.id)||changed.has(t.id)||t.id===attempt.childId||recovering&&schoolJobTab(t)));
  if(candidates.length>12)throw Error('TOO_MANY_DETAIL_CANDIDATES');
  for(const tab of candidates){
   const isNew=!baseline.has(tab.id),related=isNew&&tab.openerTabId===listTabId;
   if(related){seenAny=true;candidateKinds.set(tab.id,'new-related');}if(!schoolJobTab(tab)){if(related&&tab.status!=='loading'&&tab.url&&tab.url!=='about:blank')lastCode='PORTAL_CHANGED';continue;}
   const stale=!isNew&&!changed.has(tab.id)&&tab.id!==attempt.childId;
   const kind=isNew?(related?'new-related':'new-unlinked'):'reused';if(!stale){candidateKinds.set(tab.id,kind);seenAny=true;}
   if(tab.status==='loading')continue;
   const identity=await a.read(tab.id,expected,{identityOnly:true});
   if(!identity?.ok||identity.verified!==true){if(!stale){evidence.identityRejected++;lastCode=identity?.code||'DETAIL_IDENTITY_FAILED';}continue;}
   // A stale unchanged user tab is never guessed from title alone during recovery.
   if(stale&&identity.identity?.visibleSchoolId!==expected.schoolId){lastCode='RECOVERY_TAB_NEEDS_VISIBLE_ID';continue;}
   matches.push({tab,mode:kind,closeOwned:related});
  }
  evidence.newRelated=[...candidateKinds.values()].filter(x=>x==='new-related').length;evidence.newUnlinked=[...candidateKinds.values()].filter(x=>x==='new-unlinked').length;evidence.reused=[...candidateKinds.values()].filter(x=>x==='reused').length;
  if(matches.length>1)throw Error('AMBIGUOUS_DETAIL_CANDIDATES');
  if(matches.length===1){evidence.mode=matches[0].mode;return matches[0];}
  if(['VISIBLE_AUTH_CHALLENGE','DETAIL_IDENTITY_CONFLICT'].includes(lastCode))throw Error(lastCode);
  await a.delay(500);
 }
 if(evidence.closedRelated)throw Error('DETAIL_TAB_CLOSED_BEFORE_READ');
 if(lastCode)throw Error(lastCode);
 if(seenAny||evidence.sourceChanged)throw Error('DETAIL_CANDIDATE_NOT_READY');
 throw Error('NO_DETAIL_PAGE_CHANGE_OBSERVED');
}
