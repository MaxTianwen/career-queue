import{SCHOOL_ORIGIN}from'./school-tab-batch-controller.mjs';
const $=id=>document.getElementById('school-batch-'+id);let armed=null,requestId=null,inFlight=false,evidenceInFlight=false;const downloads=new Map();
function clearDownload(kind){const url=downloads.get(kind);if(url)URL.revokeObjectURL(url);downloads.delete(kind);const a=$(kind+'-download');a.hidden=true;a.removeAttribute('href');}
function download(kind,filename,packet){clearDownload(kind);const url=URL.createObjectURL(new Blob([JSON.stringify(packet,null,2)],{type:'application/json'}));downloads.set(kind,url);const a=$(kind+'-download');a.href=url;a.download=filename;a.hidden=false;a.click();}
function unavailable(code){$('summary').value='CQ-BATCH/0.2.5 state=unavailable code='+code;$('message').textContent='诊断读取暂不可用，请复制上方状态码。';}
const send=async(action,extra={})=>{const r=await chrome.runtime.sendMessage({type:'school-batch-'+action,...extra});if(!r?.ok)throw Error(r?.code||'REQUEST_FAILED');return r.data;};
function show(s){
 $('title-evidence').disabled=evidenceInFlight||!s.id||!s.entries?.length||!Number.isInteger(s.listTabId)||s.pendingPermission||['requesting','running','pausing','cleanup-required'].includes(s.phase);
 const unresolved=!!s.attempt&&s.attempt.schoolId===s.entries?.[s.next||0]?.schoolId;const needsReview=s.requiresNewAttemptReview===true||s.phase==='failed'&&unresolved;const currentCleanup=s.permissionCleanup?.requestId===s.permissionRequest?.id?s.permissionCleanup:null;
 $('reprepare').disabled=inFlight||!['failed','interrupted','cancelled','denied','paused'].includes(s.phase);$('new-attempt').disabled=inFlight||s.phase!=='reviewed';$('resume').disabled=inFlight||needsReview||s.phase==='reviewed';$('prepare').disabled=inFlight||!!s.entries?.length&&s.phase!=='completed';
 $('resume').textContent=unresolved?'仅检查旧尝试已有页面（不重新点击）':'准备继续未完成岗位';
 if(needsReview||s.phase==='reviewed')$('message').textContent='旧尝试没有可继续的页面证据。请勿重复授权。只读重新准备会保留失败记录；任何新点击须另行明确确认。';
 const labels={idle:'尚未准备',reviewed:'已只读重新准备，尚未启动新尝试',prepared:'已准备',armed:'待本人授权',requesting:'权限请求处理中（不保证显示提示）',running:'读取中',paused:'已暂停',completed:'已完成',denied:'授权已拒绝',cancelled:'已取消',interrupted:'已中断，需核对尝试记录',failed:'已停止','cleanup-required':'新增权限撤销失败，请重试撤销'};
 const permission=s.pendingPermission?'等待授权结果，尚未核验清理':s.owned?'本批新增权限将在停止后撤销':s.preexisting?'准备时已有覆盖权限，按原有授权保留':currentCleanup?.result==='revoked'?'本轮请求有撤销记录（当前权限见只读查询）':'本轮没有新增权限的已核验记录';
 $('status').textContent=['状态：'+(labels[s.phase]||s.phase),'完成：'+(s.jobs?.length||0)+' / '+(s.entries?.length||2),'权限记录：'+permission,'当前覆盖权限（只读查询）：'+(s.permissionAudit?.persistent===true?'存在':s.permissionAudit?.persistent===false?'不存在':'未知'),...(s.entries||[]).map(e=>e.schoolId+' — '+e.title),...(s.code?['说明：'+s.code]:[])].join('\n');
 const permissionCode=s.pendingPermission?'pending':s.owned?'batch-owned':s.preexisting?'user-owned':currentCleanup?.result==='revoked'?'revoked-recorded':'not-verified';
 $('summary').value='CQ-BATCH/0.2.5 phase='+s.phase+' done='+(s.jobs?.length||0)+'/'+(s.entries?.length||0)+' step='+(s.attempt?.stage||'none')+' mode='+(s.attempt?.mode||'none')+' perm='+permissionCode+' run='+(s.execution?.kind||'none')+' dispatchCall='+(s.execution?s.execution.openInvokedThisRun===true?'yes':'no':'unknown')+' request='+(s.permissionRequest?.requestInvoked===true?s.permissionRequest.outcome:s.permissionRequest?.requestInvoked===false?'not-invoked':'unknown')+' livePerm='+(s.permissionAudit?.persistent===true?'present':s.permissionAudit?.persistent===false?'absent':'unknown')+' code='+(s.code||'none');
 $('export').disabled=!(s.jobs?.length);if(!s.jobs?.length)clearDownload('data');if(s.phase==='armed'){armed=s.id;requestId=s.permissionRequest?.id;}$('grant').disabled=inFlight||!(s.phase==='armed'&&armed===s.id&&requestId);
}
async function action(f){try{show(await f());}catch(e){$('status').textContent=e.message;unavailable(e.message);}}
$('prepare').onclick=()=>action(async()=>{const[t]=await chrome.tabs.query({active:true,currentWindow:true});await send('prepare',{tabId:t.id});const s=await send('arm');armed=s.id;return s;});
$('reprepare').onclick=()=>action(async()=>{const[t]=await chrome.tabs.query({active:true,currentWindow:true});return send('reprepare',{tabId:t.id});});
$('new-attempt').onclick=()=>action(()=>send('arm',{confirmNewAttempt:true}));
$('resume').onclick=()=>action(async()=>{const s=await send('arm');armed=s.id;return s;});
$('grant').onclick=()=>{
 // Both calls start synchronously in this user gesture; no await before native request.
 if(inFlight)return;inFlight=true;const id=armed,token=requestId;$('grant').disabled=true;
 const begun=send('begin',{id,requestId:token}).then(()=>true,()=>false);
 let request;try{request=Promise.resolve(chrome.permissions.request({origins:[SCHOOL_ORIGIN]})).then(accepted=>({accepted:!!accepted,invoked:true,outcome:accepted?'accepted':'rejected'}),()=>({accepted:false,invoked:true,outcome:'error'}));}catch{request=Promise.resolve({accepted:false,invoked:true,outcome:'error'});}
 void action(async()=>{try{const report=await request;const persisted=await begun||await send('begin',{id,requestId:token}).then(()=>true,()=>false);return await send('granted',{id,requestId:token,accepted:report.accepted,requestReport:persisted?report:{...report,outcome:'error'}});}finally{inFlight=false;}});
};
for(const name of ['pause','cancel','cleanup'])$(name).onclick=()=>action(()=>send(name));
$('export').onclick=async()=>{try{const packet=await send('export');if(packet?.schema!=='career-queue-school-capture-v1'||!Array.isArray(packet.jobs)||!packet.jobs.length)throw Error('NO_VERIFIED_JOBS_TO_EXPORT');download('data','career-queue-school-two-jobs.json',packet);$('message').textContent='已下载岗位数据。这不是批次诊断。';}catch(e){clearDownload('data');$('message').textContent=e.message==='NO_VERIFIED_JOBS_TO_EXPORT'?'暂无已核对岗位，未生成空文件。请点击顶部“下载批次诊断 JSON”。':e.message;}};
$('diagnostic').onclick=async()=>{try{const packet=await send('diagnostic');if(packet?.schema!=='career-queue-school-batch-diagnostic-v1')throw Error('INVALID_DIAGNOSTIC_RESPONSE');download('diagnostic','career-queue-school-batch-diagnostic.json',packet);$('message').textContent='已下载批次诊断：career-queue-school-batch-diagnostic.json';}catch(e){clearDownload('diagnostic');unavailable(e.message);}};
void action(()=>send('status'));setInterval(()=>{void action(()=>send('status'));},1500);

$('title-evidence').onclick=async()=>{if(evidenceInFlight)return;evidenceInFlight=true;$('title-evidence').disabled=true;
 try{const[t]=await chrome.tabs.query({active:true,currentWindow:true});const packet=await send('title-evidence',{tabId:t?.id});if(packet?.schema!=='career-queue-school-title-evidence-v1')throw Error('INVALID_TITLE_EVIDENCE');download('title-evidence','career-queue-school-title-evidence.json',packet);$('title-evidence-message').textContent='已下载已选标题的只读诊断。未点击岗位、未请求权限。普通扩展无法枚举监听器或回溯控制台错误。';}
 catch(e){clearDownload('title-evidence');const messages={SAVED_SELECTION_REQUIRED:'没有已保存的所选岗位；未自动准备新批次。',ORIGINAL_SELECTED_LIST_REQUIRED:'请在原来已选岗位所在的列表标签打开扩展。',TITLE_EVIDENCE_ACCESS_UNAVAILABLE:'本次临时页面访问不可用。未请求权限或重试；请保留此状态。',SELECTED_TITLE_NOT_UNIQUE_OR_VISIBLE:'原来选中的标题不在当前可见列表或不唯一；未改选其它岗位。',SELECTED_IDENTITY_CHANGED:'当前标题身份与原选择不同；已停止。'};$('title-evidence-message').textContent=messages[e.message]||e.message;}
 finally{evidenceInFlight=false;void action(()=>send('status'));}
};
