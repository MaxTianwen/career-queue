import {schoolBatchAdapter} from './school-selected-client.mjs';
import {selectedBatch,batchPacket} from './school-selected-batch.mjs';
import {schoolLocalState} from './school-local-state.mjs';
const $=id=>document.getElementById(id),store=schoolLocalState(),tabId=Number(new URL(location.href).searchParams.get('tab'));let adapter,engine,entries=[],saved=null,busy=false,urls=[];
const messages={BATCH_CHANGED:'其他面板已改变批次。请重新检查所选岗位；旧页面不能覆盖新进度。',BUSY:'另一面板正在操作，请等待完成。',ROUTE_EVIDENCE_REQUIRED:'没有可核验的同源详情链接。请下载最小诊断；保留手动读取，不要重复运行。',BATCH_LIMIT:'请明确选择1至5岗。',PAGE_CHANGED:'原页面或岗位身份已改变，已停止。',CANCELLED:'已取消后续读取；已保存结果保留。',OPEN_ORIGINAL_LIST:'请自行返回最初学校列表，再检查剩余岗位。',DETAIL_IDENTITY_MISMATCH:'详情身份不一致，已停止。',VISIBLE_AUTH_CHALLENGE:'请自行完成登录或验证，之后重新检查。',BATCH_NOT_READY:'请先检查读取方式。'};
function download(id,value,name){const a=$(id),url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));urls.push(url);a.href=url;a.download=name;a.hidden=false;}
function render(s){saved=s;for(const u of urls)URL.revokeObjectURL(u);urls=[];$('export').hidden=$('diagnostic').hidden=true;$('results').replaceChildren();for(const p of s.packets||[]){const e=document.createElement('p');e.textContent=p.entry.schoolId+' · '+p.entry.title+' · '+p.entry.term+' · '+(p.detail.duration||'独立时长字段未知');$('results').append(e);}if(s.packets?.length)download('export',batchPacket(s.packets),'career-queue-school-selected.json');
 download('diagnostic',{schema:'career-queue-school-route-evidence-v3',extensionVersion:'0.3.8',exportedAt:new Date().toISOString(),phase:s.phase,code:s.code||null,readCount:s.packets?.length||0,selected:s.routes?.map(r=>({schoolId:r.entry.schoolId,supported:r.supported,kind:r.kind,targets:r.targets,target:r.target,inline:r.inline,evidence:r.evidence||null}))||[],scope:'selected visible title attributes only; closed-vocabulary static syntax; no click, execution, custom names, raw code, URLs, JD or login data; runtime behavior unproven'},'career-queue-school-route-evidence-v3.json');
 $('progress').textContent=(messages[s.code]||({ready:'检查通过。核对列表后确认顺序读取。',complete:'读取完成；请下载后在工作台预览和确认导入。',opening:'正在打开所选岗位…',reading:'正在核对并读取…',saved:'已保存当前岗位，准备返回列表。',interrupted:'上次运行已中断；不会自动继续。',blocked:'读取方式尚待证据。',stopped:'读取已停止。'}[s.phase]||s.phase))+' '+(s.packets?.length||0)+' / '+(s.plan?.length||0)+' 已保存'+(s.code?' ['+s.code+']':'');
 $('start').disabled=busy||s.phase!=='ready';$('cancel').disabled=!busy;$('retry').disabled=busy||!['stopped','cancelled','interrupted'].includes(s.phase);
}
async function action(fn){if(busy)return;busy=true;$('inspect').disabled=$('start').disabled=$('retry').disabled=true;try{await navigator.locks.request('career-queue-school-selected',{ifAvailable:true},async lock=>{if(!lock)throw Error('BUSY');await fn();});}catch(error){$('progress').textContent=(messages[error.message]||'读取失败，保留页面并反馈错误码。')+' ['+error.message+']';}finally{busy=false;$('inspect').disabled=false;$('cancel').disabled=true;$('start').disabled=engine?.state?.phase!=='ready';$('retry').disabled=!['stopped','cancelled','interrupted'].includes(saved?.phase);}}
function makeEngine(){engine=selectedBatch(adapter,render);}
$('inspect').onclick=()=>action(async()=>{const chosen=[...document.querySelectorAll('#choices input:checked')].map(n=>entries.find(e=>e.schoolId===n.value));if(!chosen.length||chosen.length>5)throw Error('BATCH_LIMIT');adapter=await schoolBatchAdapter(chrome,tabId,store);makeEngine();await engine.prepare(chosen);});
$('start').onclick=()=>action(async()=>{if(!engine)throw Error('BATCH_NOT_READY');const latest=await store.load('selected-batch');if(latest?.id!==engine.state.id||latest?.revision!==engine.state.revision){engine=null;throw Error('BATCH_CHANGED');}$('cancel').disabled=false;await engine.run();});
$('cancel').onclick=()=>{engine?.cancel();$('progress').textContent='正在取消；不再打开下一岗。';$('cancel').disabled=true;};
$('retry').onclick=()=>action(async()=>{const previous=saved;adapter=await schoolBatchAdapter(chrome,tabId,store);makeEngine();await engine.prepare(previous.plan,previous);});
try{const prior=await store.load('selected-batch');if(prior&&prior.tabId===tabId&&Date.now()-prior.updatedAt<86400000){render({...prior,phase:prior.phase==='complete'?'complete':'interrupted'});}adapter=await schoolBatchAdapter(chrome,tabId,store);entries=await adapter.list();for(const e of entries){const label=document.createElement('label');label.className='choice';const input=document.createElement('input');input.type='checkbox';input.value=e.schoolId;label.append(input,document.createTextNode(e.schoolId+' · '+e.title+' · '+e.company+' · '+e.term));$('choices').append(label);}if(!saved)$('progress').textContent='请选择1至5岗，然后检查读取方式。';}catch(error){$('progress').textContent=(messages[error.message]||'无法读取原学校列表，请在该列表重新打开助手。')+' ['+error.message+']';}

let sourceUrl=null;
$('source-inspect').onclick=()=>action(async()=>{
 $('source-export').hidden=true;if(sourceUrl)URL.revokeObjectURL(sourceUrl);sourceUrl=null;
 const chosen=[...document.querySelectorAll('#choices input:checked')].map(n=>entries.find(e=>e.schoolId===n.value));
 if(chosen.length!==1){$('progress').textContent='源码检查仅允许勾选1岗。';return;}
 $('diagnostic').hidden=true;
 const scoped=await schoolBatchAdapter(chrome,tabId,store),report=await scoped.inspectSource(chosen);
 sourceUrl=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
 const a=$('source-export');a.href=sourceUrl;a.download='career-queue-restricted-source-local.json';a.hidden=false;
 $('progress').textContent=({STATIC_DEFINITION_FOUND:'已定位目标方法的静态定义；路由仍未验证。请保存本机记录。',NO_ELIGIBLE_DECLARED_SCRIPT:'没有符合边界的已引用外部脚本；记录包含各项排除数量，未进行源码请求。',SOURCE_SEARCH_LIMIT:'达到总量或候选数量界限；记录包含实际检查数量与剩余数量。',SOURCE_PARTIAL_SEARCH:'已继续检查后续候选；部分文件过大，仅检查前缀或跳过。记录包含每个文件的原因。',TARGET_DEFINITION_UNRESOLVED:'未定位可解析的目标定义；记录包含逐文件结果，不代表必须登录。'}[report.status]||'静态检查结束。请保存本机记录。');
});
