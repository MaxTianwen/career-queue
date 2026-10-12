export async function schoolTitleEvidenceRequest(a,tabId){
 const s=a.status();
 if(!s.id||!s.entries?.length||s.entries.length>2)throw Error('SAVED_SELECTION_REQUIRED');
 if(!Number.isInteger(tabId)||tabId!==s.listTabId)throw Error('ORIGINAL_SELECTED_LIST_REQUIRED');
 if(s.pendingPermission||['requesting','running','pausing','cleanup-required'].includes(s.phase))throw Error('TITLE_EVIDENCE_BUSY');
 let result;try{result=await a.read(tabId,s.entries.map(({schoolId,title,company,term})=>({schoolId,title,company,term})));}catch{throw Error('TITLE_EVIDENCE_ACCESS_UNAVAILABLE');}
 if(!result?.ok)throw Error(result?.code||'TITLE_EVIDENCE_UNAVAILABLE');
 if(result.schema!=='career-queue-school-title-evidence-v1'||result.jobs?.length!==s.entries.length||result.jobs.some((j,i)=>j.schoolId!==s.entries[i].schoolId||j.identityVerified!==true))throw Error('TITLE_EVIDENCE_IDENTITY_FAILED');
 return{...result,extensionVersion:'0.2.5',batchId:s.id,selection:'saved-batch-only',executionWorld:'ISOLATED',collectorMutatesBatch:false};
}
