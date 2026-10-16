import {currentCapturePacket} from './school-current-import.mjs';
import{createHash,randomUUID}from'node:crypto';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fail=message=>{throw Object.assign(Error(message),{status:400})};
function plan(store,owner,packet){
 if(packet?.schema==='career-queue-school-current-page-batch-v1'){
  if(JSON.stringify(packet).length>800000||!Array.isArray(packet.packets)||!packet.packets.length||packet.packets.length>5)fail('请选择1至5个已核验的当前页岗位文件');
  packet={schema:'career-queue-school-capture-v1',jobs:packet.packets.flatMap(p=>currentCapturePacket(store,owner,p).jobs)};
 }
 if(packet?.schema==='career-queue-school-current-page-v1')packet=currentCapturePacket(store,owner,packet);
 if(packet?.schema!=='career-queue-school-capture-v1'||!Array.isArray(packet.jobs)||!packet.jobs.length||packet.jobs.length>50||JSON.stringify(packet).length>800000)fail('请导入已适配的岗位批次文件；诊断文件不能直接导入');
 const seen=new Set(),rows=[],origins=new Set();
 for(const item of packet.jobs){
  if(!/^\d{1,10}$/.test(item.schoolId)||seen.has(item.schoolId))fail('School ID 缺失或重复');seen.add(item.schoolId);
  let u;try{u=new URL(item.url)}catch{fail('来源链接无效')}
  if(u.protocol!=='https:'||u.username||u.password||u.hash||[...u.searchParams.keys()].some(k=>/token|session|auth|password|secret|key/i.test(k)))fail('来源链接包含不可保存的会话参数');origins.add(u.origin);
  const record=store.schoolOpportunities(owner).find(r=>r.schoolId===item.schoolId);if(!record)fail('学校ID尚未在当前账户导入：'+item.schoolId);
  const norm=x=>String(x||'').trim().replace(/\s+/g,' ').toLowerCase();if(!item.title||!item.company||norm(item.title)!==norm(record.row.title)||norm(item.company)!==norm(record.row.company))fail('学校ID对应的标题或公司不一致：'+item.schoolId);
  for(const [k,max]of [['jd',60000],['duration',2000],['applicationInstructions',12000]])if(typeof(item[k]??'')!=='string'||String(item[k]||'').length>max)fail('岗位字段超出限制');
  if(item.status!=='done'||!item.jd?.trim()||!Number.isFinite(Date.parse(item.capturedAt)))fail('详情尚未成功读取');
  const payload={schoolId:item.schoolId,url:u.href,title:item.title,company:item.company,jd:item.jd,duration:item.duration||'',applicationInstructions:item.applicationInstructions||'',capturedAt:item.capturedAt,...(item.currentPageEvidence?{currentPageEvidence:item.currentPageEvidence}:{})};const digest=hash(payload);
  const after={...record.row,jd:item.jd,sourceEvidence:{url:u.href,retrievedAt:item.capturedAt,kind:'school-visible-page'},schoolCapture:{sha256:digest}};
  if(item.currentPageEvidence)after.schoolCurrentPageEvidence=item.currentPageEvidence;
  for(const k of ['duration','applicationInstructions'])if(payload[k])after[k]=payload[k];
  rows.push({schoolId:item.schoolId,before:record.row,after,unchanged:record.row.schoolCapture?.sha256===digest});
 }
 if(origins.size!==1)fail('一个批次只能来自同一个学校站点');
 return {rows,fingerprint:hash(rows),count:rows.filter(x=>!x.unchanged).length};
}
export function schoolCapture(store,owner,input,apply=false){
 if(!apply)return plan(store,owner,input.packet);
 if(input.confirmed!==true)fail('请先预览并确认当前批次');store.db.exec('BEGIN IMMEDIATE');
 try{const p=plan(store,owner,input.packet);if(p.count&&input.fingerprint!==p.fingerprint)fail('原岗位或批次已改变，请重新预览');const requestId=randomUUID();
 for(const row of p.rows.filter(r=>!r.unchanged)){const link=store.schoolLinks(owner).find(l=>l.schoolId===row.schoolId);store.schoolAudit(owner,row.schoolId,'update',{schoolId:row.schoolId,jobId:link?.jobId||null,row:row.before},{schoolId:row.schoolId,jobId:link?.jobId||null,row:row.after},'本人确认导入学校岗位详情批次',requestId+':'+row.schoolId,p.fingerprint);store.db.prepare('UPDATE school_opportunities SET snapshot=?,updated=? WHERE user_id=? AND school_id=?').run(JSON.stringify(row.after),store.now(),owner,row.schoolId);if(link)store.db.prepare('UPDATE school_links SET snapshot=? WHERE user_id=? AND school_id=?').run(JSON.stringify(row.after),owner,row.schoolId);}
 store.db.exec('COMMIT');return {updated:p.count,unchanged:p.rows.length-p.count};}catch(e){store.db.exec('ROLLBACK');throw e;}
}
