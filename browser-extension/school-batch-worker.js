import{schoolTitleEvidence}from'./school-title-evidence.js';
import{schoolTitleEvidenceRequest}from'./school-title-evidence-request.mjs';
import{schoolTabBatchController,SCHOOL_ORIGIN,coversSchoolOrigin}from'./school-tab-batch-controller.mjs';
import{schoolTrialState}from'./school-trial-state.mjs';
import{schoolVisibleNavigation}from'./school-visible-navigation.js';
import{schoolDetailReader}from'./school-detail-reader.js';
const origins=[SCHOOL_ORIGIN];
const execute=async(tabId,func,args)=>(await chrome.scripting.executeScript({target:{tabId},world:'ISOLATED',func,args}))[0]?.result;
// Install bounded metadata listeners before any batch message can dispatch a click.
const eventEpoch=crypto.randomUUID();let eventSequence=0;const tabEventLog=[];
const observeTabEvent=(kind,id,openerTabId)=>{tabEventLog.push({kind,id,openerTabId,sequence:++eventSequence});if(tabEventLog.length>100)tabEventLog.shift();};
chrome.tabs.onCreated?.addListener(tab=>observeTabEvent('created',tab.id,tab.openerTabId));
chrome.tabs.onUpdated?.addListener((id,change)=>{if(change.status||change.url)observeTabEvent('updated',id);});
chrome.tabs.onActivated?.addListener(info=>observeTabEvent('activated',info.tabId));
chrome.tabs.onRemoved?.addListener(id=>observeTabEvent('removed',id));
const batch=schoolTabBatchController({store:schoolTrialState(globalThis.indexedDB,'career-queue-school-batch'),uuid:()=>crypto.randomUUID(),
 hasPersistentPermission:async()=>(await chrome.permissions.getAll()).origins?.some(coversSchoolOrigin)===true,hasPermission:()=>chrome.permissions.contains({origins}),hasExactPermission:async()=>(await chrome.permissions.getAll()).origins?.includes(SCHOOL_ORIGIN)===true,removePermission:()=>chrome.permissions.remove({origins}),
 popupAlive:async documentId=>!!chrome.runtime.getContexts&&(await chrome.runtime.getContexts({contextTypes:['POPUP'],documentIds:[documentId],documentUrls:[chrome.runtime.getURL('popup.html')]})).length===1,markTabEvents:()=>({epoch:eventEpoch,sequence:eventSequence}),tabEvents:mark=>mark?.epoch===eventEpoch?tabEventLog.filter(e=>e.sequence>mark.sequence):[],getTab:id=>chrome.tabs.get(id),tabs:()=>chrome.tabs.query({}),closeTab:id=>chrome.tabs.remove(id),activate:id=>chrome.tabs.update(id,{active:true}),delay:ms=>new Promise(r=>setTimeout(r,ms)),
 receipt:id=>execute(id,schoolVisibleNavigation,['receipt']),scan:id=>execute(id,schoolVisibleNavigation,['scan']),open:(id,e)=>execute(id,schoolVisibleNavigation,['open',e]),read:(id,e,o)=>execute(id,schoolDetailReader,[e,o])});
chrome.runtime.onMessage.addListener((m,sender,reply)=>{
 if(sender.id!==chrome.runtime.id||sender.url!==chrome.runtime.getURL('popup.html')||!m?.type?.startsWith('school-batch-'))return;
 (async()=>{await batch.ready;switch(m.type){case'school-batch-title-evidence':return schoolTitleEvidenceRequest({status:()=>batch.status(),read:(id,entries)=>execute(id,schoolTitleEvidence,[entries])},m.tabId);case'school-batch-status':return batch.audit();case'school-batch-prepare':return batch.prepare(m.tabId);case'school-batch-reprepare':return batch.reprepare(m.tabId);case'school-batch-arm':return batch.arm(m.confirmNewAttempt===true);case'school-batch-begin':if(!m.requestId)throw Error('PERMISSION_REQUEST_ID_REQUIRED');return batch.begin(m.id,sender.documentId||null,m.requestId);case'school-batch-granted':if(!m.requestId)throw Error('PERMISSION_REQUEST_ID_REQUIRED');return batch.granted(m.id,m.accepted===true,m.requestId,sender.documentId||null,m.requestReport);case'school-batch-pause':return batch.pause();case'school-batch-cancel':return batch.cancel();case'school-batch-cleanup':return batch.retryCleanup();case'school-batch-export':{const packet=batch.packet();if(!packet.jobs.length)throw Error('NO_VERIFIED_JOBS_TO_EXPORT');return packet;}case'school-batch-diagnostic':{const current=await batch.audit();return{...batch.diagnostic(),permissionAudit:current.permissionAudit};}default:throw Error('INVALID_ACTION');}})().then(data=>reply({ok:true,data}),e=>reply({ok:false,code:/^[A-Z][A-Z0-9_]{0,70}$/.test(e.message||'')?e.message:'BATCH_REQUEST_FAILED'}));return true;
});

chrome.runtime.onStartup?.addListener(()=>{void batch.ready.catch(()=>{});});
