import {schoolVisibleNavigation} from './school-visible-navigation.js';
import {readSchoolDiagnostic,diagnosticFailure} from './school-diagnostic-client.js';
import {schoolDiagnostic} from './school-diagnostic.js';
import {pageFields} from './page-fields.js';
const $=id=>document.getElementById(id), status=$('status');
let preview=null, busy=false;
async function request(operation,code,value) {
  const response=await fetch('http://127.0.0.1:4322/api/browser-fill/'+operation,{method:'POST',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json',Authorization:'Bearer '+code},body:JSON.stringify(value)});
  const data=await response.json(); if (!response.ok) throw Error(data.error||'本机服务连接失败'); return data;
}
async function run(task) {
  if(busy)return; busy=true; $('code').disabled=$('confirmed').disabled=true; $('preview').disabled=$('fill').disabled=true; status.textContent='正在核对…';
  try { await task(); } catch(error) { preview=null; status.textContent='已暂停：'+error.message; }
  finally {busy=false; $('code').disabled=$('confirmed').disabled=false; $('preview').disabled=false; $('fill').disabled=!preview;}
}
async function inspect(tab,plan,mode,bindings) {
  const fields=mode==='fill'?plan.fields:plan.fields.map(({index,label})=>({index,label}));
  const [result]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:pageFields,args:[mode,plan.targetUrl,fields,bindings??null]});
  if (!result?.result) throw Error('页面无法识别，请本人处理'); return result.result;
}
$('code').addEventListener('input',()=>{preview=null;$('fill').disabled=true;$('confirmed').checked=false;$('plan').replaceChildren();});
$('preview').addEventListener('click',()=>run(async()=>{
  preview=null; $('confirmed').checked=false; $('plan').replaceChildren();
  const code=$('code').value.trim(); if(!/^[a-f0-9]{64}$/.test(code))throw Error('请粘贴有效配对码');
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true}); if(!tab?.url)throw Error('未找到当前页面');
  const plan=await request('preview',code,{targetUrl:tab.url});
  const result=await inspect(tab,plan,'preview');
  for(const text of [plan.targetUrl,...plan.fields.map(f=>f.label+'：'+f.answer),...plan.manual.map(f=>'本人处理：'+f.label)]){const p=document.createElement('p');p.textContent=text;$('plan').append(p);}
  preview={code,tab,plan,bindings:result.bindings};status.textContent='请核对后确认；尚未填写。';
}));
$('fill').addEventListener('click',()=>run(async()=>{
  if(!preview || !$('confirmed').checked)throw Error('请先预览并勾选确认');
  const current=preview;const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(tab?.id!==current.tab.id || tab.url!==current.tab.url)throw Error('当前页面已变化，请重新预览');
  const before=await inspect(tab,current.plan,'preview');
  if(JSON.stringify(before.bindings)!==JSON.stringify(current.bindings))throw Error('页面字段已变化');
  const plan=await request('confirm',current.code,{targetUrl:tab.url,fingerprint:current.plan.fingerprint,confirmed:true});
  preview=null; $('code').value='';
  const result=await inspect(tab,plan,'fill',current.bindings);
  status.textContent='已填写 '+result.filled+' 项普通文本。请本人核对并完成剩余内容；尚未提交。';
}));

let diagnosticBusy=false,diagnosticUrl=null;
for(const kind of ['list','detail'])$('school-'+kind).addEventListener('click',async()=>{
 if(diagnosticBusy||busy)return;diagnosticBusy=true;const message=$('school-diagnostic-status'),download=$('school-download');download.hidden=true;message.textContent='正在读取可见岗位结构…';
 try{const packet=await readSchoolDiagnostic(chrome,schoolDiagnostic,kind,schoolVisibleNavigation);if(diagnosticUrl)URL.revokeObjectURL(diagnosticUrl);diagnosticUrl=URL.createObjectURL(new Blob([JSON.stringify(packet,null,2)],{type:'application/json'}));download.href=diagnosticUrl;download.download='career-queue-school-'+kind+'-diagnostic.json';download.hidden=false;download.click();message.textContent='诊断已生成并请求保存。若未下载，点击保存链接。尚未采集批次或导入岗位。';}catch(e){message.textContent=diagnosticFailure(e,download.hidden?'download':'download-click');}finally{diagnosticBusy=false;}
});
