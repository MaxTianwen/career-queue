// Keep raw browser/page errors private. These codes never include page content.
const messages={
 TAB_QUERY_FAILED:'无法读取当前标签页。',NO_ACTIVE_TAB:'未找到当前标签页。',
 HTTPS_REQUIRED:'当前页不是 HTTPS 岗位页。',INVALID_KIND:'诊断类型无效。',
 INJECTION_DENIED:'浏览器拒绝在当前页面运行助手；未读取页面。',
 INJECTION_FAILED:'浏览器未完成脚本注入；未确认读取结果。',
 NO_FRAME_RESULT:'主页面未返回结果，可能发生导航或页面限制。',
 EXECUTION_FAILED:'页面脚本执行失败，未返回岗位内容。',
 INVALID_RESULT:'页面返回的诊断结构无效，未保存。',
 VISIBLE_AUTH_CHALLENGE:'发现可见密码输入框或验证框；请本人检查是否有登录或验证遮挡。',
 FRAME_CONTENT_UNREAD:'主页面未发现岗位结构，但有可见内嵌页面；当前权限未读取其内容。',
 NO_JOB_STRUCTURE:'主页面尚未匹配岗位标题、表格或详情段落；这不表示未登录。',
 DOM_READ_FAILED:'读取可见结构时失败；未保存不完整内容。',
 DOWNLOAD_FAILED:'诊断已返回，但浏览器未完成保存步骤。'
};
function failure(stage,code){return Object.assign(new Error(code),{diagnostic:true,stage,code});}
export function diagnosticFailure(error,stage='download'){
 const known=error?.diagnostic===true&&Object.hasOwn(messages,error.code);
 const code=known?error.code:'DOWNLOAD_FAILED';
 const safeStage=known&&['tab','preflight','inject','structure','result'].includes(error.stage)?error.stage:stage==='download-click'?'download-click':'download';
 return `已停止 [CQ-SD/${safeStage}/${code}]：${messages[code]} 请反馈这个错误码；无需反复点击。`;
}
export async function readSchoolDiagnostic(api,func,kind,navigationFunc=null){
 let tabs;try{tabs=await api.tabs.query({active:true,currentWindow:true});}catch{throw failure('tab','TAB_QUERY_FAILED');}
 const tab=tabs?.[0];if(!Number.isInteger(tab?.id)||tab.id<0)throw failure('tab','NO_ACTIVE_TAB');
 if(tab.url&&!tab.url.startsWith('https://'))throw failure('preflight','HTTPS_REQUIRED');
 let values;
 try{values=await api.scripting.executeScript({target:{tabId:tab.id},world:'ISOLATED',func,args:[kind]});}
 catch(error){const denied=/cannot access|permission|extensions gallery|cannot be scripted|restricted|not allowed/i.test(String(error?.message||''));throw failure('inject',denied?'INJECTION_DENIED':'INJECTION_FAILED');}
 const frame=values?.find(v=>v.frameId===0)??(values?.length===1?values[0]:null);
 if(!frame)throw failure('result','NO_FRAME_RESULT');
 if(frame.error)throw failure('inject','EXECUTION_FAILED');
 const packet=frame.result;
 if(packet?.schema==='career-queue-school-diagnostic-error-v1'&&packet.ok===false){
  if(Object.hasOwn(messages,packet.code)&&['preflight','structure','result'].includes(packet.stage))throw failure(packet.stage,packet.code);
  throw failure('result','INVALID_RESULT');
 }
 if(packet?.schema!=='career-queue-school-diagnostic-v1'||packet.kind!==kind||!Array.isArray(packet.headings)||!Array.isArray(packet.rows)||!Array.isArray(packet.sections)||typeof packet.origin!=='string'||!packet.origin.startsWith('https://'))throw failure('result','INVALID_RESULT');
 if(kind==='list'&&navigationFunc){
  try{const nav=await api.scripting.executeScript({target:{tabId:tab.id},world:'ISOLATED',func:navigationFunc,args:['scan']});const result=nav.find(r=>r.frameId===0)?.result;if(result?.ok===true&&Array.isArray(result.entries))packet.navigation=result;else packet.navigation={ok:false,code:'ENTRY_STRUCTURE_UNAVAILABLE'};}catch{packet.navigation={ok:false,code:'ENTRY_SCAN_FAILED'};}
 }
 return packet;
}
