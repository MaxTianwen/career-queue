// Self-contained activeTab function. Selected title attributes are reduced locally to safe syntax categories.
export function schoolVisibleNavigation(mode,expected=null){
 const stop=code=>({ok:false,code});
 if(location.origin!=='https://recruitstudents.torontomu.ca'||location.pathname!=='/myAccount/coop/postings.htm')return stop('PORTAL_CHANGED');
 const visible=e=>Boolean(e?.getClientRects().length)&&getComputedStyle(e).visibility!=='hidden'&&!e.closest('[hidden],[aria-hidden=true]');
 if([...document.querySelectorAll('input[type=password],iframe[title*=captcha i],iframe[title*=challenge i]')].some(visible))return stop('VISIBLE_AUTH_CHALLENGE');
 const text=e=>{let s='';const w=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);for(let n=w.nextNode();n&&s.length<10000;n=w.nextNode()){const p=n.parentElement;if(p&&visible(p)&&!p.closest('input,textarea,select,script,style,[contenteditable=true]'))s+=' '+n.textContent;}return s.replace(/\s+/g,' ').trim();};
 const cells=row=>[...row.children].filter(e=>/^(TD|TH)$/.test(e.tagName)||['cell','columnheader','gridcell'].includes(e.getAttribute('role')));
 const entries=[];
 for(const table of document.querySelectorAll('table,[role=grid]')){
  const rows=[...table.querySelectorAll('tr,[role=row]')].filter(visible);const header=rows.find(r=>cells(r).some(c=>/^Job Title$/i.test(text(c)))&&cells(r).some(c=>/^ID$/i.test(text(c))));if(!header)continue;
  const labels=cells(header).map(text),at=name=>labels.findIndex(x=>x.toLowerCase()===name.toLowerCase());
  for(const row of rows){const cs=cells(row),id=text(cs[at('ID')]||row);if(!/^\d{4,10}$/.test(id))continue;const titleCell=cs[at('Job Title')];if(!titleCell)continue;
   const title=text(titleCell).replace(/^NEW\s+/,'');if(!title||/^(apply|applied|shortlist|submit)\b/i.test(title))continue;
   entries.push({id,title,company:text(cs[at('Organization')]||titleCell),term:text(cs[at('Term')]||titleCell),titleCell});
  }
 }

 // Analyze only literal attributes of the selected visible title. Never evaluate code.
 // Output is a closed vocabulary: even custom identifiers and string values stay private.
 function scriptShape(raw,id){
  if(!raw.trim())return {syntax:'empty',mechanism:'none'};
  if(raw.length>4096)return {syntax:'over-limit',mechanism:'unknown'};
  let code=raw.trim().replace(/^javascript:\s*/i,'').replace(/^return\s+/,'').replace(/;?\s*return\s+false\s*;?$/,'').replace(/;$/,'').trim();
  if(/^(?:void\s*\(\s*0\s*\)|false)$/.test(code))return {syntax:'inert',mechanism:'none'};
  const call=code.match(/^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*){0,3})\s*\(([\s\S]*)\)$/);
  const assign=code.match(/^((?:window\.)?location(?:\.href)?)\s*=\s*([\s\S]+)$/);
  if(!call&&!assign)return {syntax:'unparsed',mechanism:'unknown'};
  const tail=call?call[2]:assign[2],args=[];let rest=tail.trim();
  while(rest){
   const m=rest.match(/^("[^"\\\r\n]*"|'[^'\\\r\n]*'|\d+|this|event|null|true|false)\s*(,|$)/);
   if(!m||args.length>=8)return {syntax:'unparsed',mechanism:'unknown'};
   const token=m[1],quoted=/^["']/.test(token),value=quoted?token.slice(1,-1):token;
   let type=value===id?'selected-id':quoted?'redacted-string':/^\d+$/.test(value)?'number':['this','event'].includes(value)?value:'literal';
   if(quoted&&['_blank','_self','_parent','_top'].includes(value))type='target:'+value;
   if(quoted&&value==='open')type='open-keyword';
   args.push(type);rest=rest.slice(m[0].length).trim();if(m[2]&&!rest)return {syntax:'unparsed',mechanism:'unknown'};
  }
  const name=call?.[1]||assign[1];
  const mechanism=assign||/^(?:window\.)?location\.(?:assign|replace)$/.test(name)?'location-write-syntax':/^(?:window\.)?open$/.test(name)?'window-open-syntax':/\.showModal$/.test(name)?'dialog-show-modal-syntax':'custom-call-unknown';
  return {syntax:assign?'literal-assignment':'literal-call',mechanism,arguments:args,calleeParts:name.split('.').length};
 }

 // Closed-vocabulary lexical shape, not a JavaScript parser or execution trace.
 // Custom identifiers become local aliases; no source/literal bytes are exported.
 function maskedShape(raw,id){
  if(raw.length>4096)return {status:'over-limit',tokens:[]};
  const tokens=[],names=new Map();let i=0;
  const known=new Set(['return','false','true','null','this','event','function','if','else','window','document','location','href','open','assign','replace','showModal','preventDefault']);
  while(i<raw.length&&tokens.length<160){
   const c=raw[i];if(/\s/.test(c)){i++;continue;}
   if(raw.slice(i,i+2)==='//'){const end=raw.indexOf('\n',i+2);i=end<0?raw.length:end+1;continue;}
   if(raw.slice(i,i+2)==='/*'){const end=raw.indexOf('*/',i+2);if(end<0)return {status:'unterminated-comment',tokens};i=end+2;continue;}
   if(c==='"'||c==="'"||c.charCodeAt(0)===96){
    const quote=c,start=++i;let escaped=false,closed=false;
    while(i<raw.length){if(raw[i]==='\\'){escaped=true;i+=2;continue;}if(raw[i]===quote){closed=true;break;}i++;}
    if(!closed)return {status:'unterminated-literal',tokens};
    const value=raw.slice(start,i++);tokens.push(quote.charCodeAt(0)===96?'opaque-template':!escaped&&value===id?'selected-id-string':!escaped&&['_blank','_self','_parent','_top'].includes(value)?'target:'+value:'string');continue;
   }
   const name=raw.slice(i).match(/^[A-Za-z_$][A-Za-z0-9_$]*/)?.[0];
   if(name){if(!names.has(name))names.set(name,'identifier-'+(names.size+1));tokens.push(known.has(name)?'keyword:'+name:names.get(name));i+=name.length;continue;}
   const number=raw.slice(i).match(/^\d+(?:\.\d+)?/)?.[0];if(number){tokens.push(number===id?'selected-id-number':'number');i+=number.length;continue;}
   tokens.push('(){}[];,.?:=+-*!&|<>/%'.includes(c)?c:'other');i++;
  }
  return {status:i<raw.length?'token-limit':'complete',tokens,interpretation:'masked-lexical-shape-only'};
 }

 function titleEvidence(a,href,id){
  if(!a)return null;
  const events=[];
  for(const name of ['onclick','ondblclick','onpointerdown','onpointerup','onmousedown','onmouseup','onkeydown','onkeyup','ontouchstart','ontouchend']){
   const raw=a.getAttribute(name);if(raw!==null)events.push({attribute:name,...scriptShape(raw,id),shape:maskedShape(raw,id)});
  }
  return {version:3,observedAt:new Date().toISOString(),events,scriptHref:/^javascript:/i.test(href)?scriptShape(href,id):null,observation:'static-title-attributes-only',runtimeOutcome:'unproven'};
 }

 if(mode==='routes'||mode==='source-target'){
  if(mode==='source-target'&&expected?.length!==1)return stop('SOURCE_SELECT_ONE');
  if(!Array.isArray(expected)||!expected.length||expected.length>5||new Set(expected.map(e=>e.schoolId)).size!==expected.length)return stop('BATCH_LIMIT');
  const routes=[];
  for(const e of expected){const matches=entries.filter(r=>r.id===e.schoolId);if(matches.length!==1)return stop('PAGE_CHANGED');const row=matches[0];if(['title','company','term'].some(k=>row[k]!==e[k]))return stop('PAGE_CHANGED');
   const targets=[...row.titleCell.querySelectorAll('a')].filter(a=>visible(a)&&text(a)===e.title),a=targets.length===1?targets[0]:null,href=a?.getAttribute('href')||'';let url=null,kind=!a?'ambiguous-or-missing':/^javascript:/i.test(href)?'script-link':href.startsWith('#')?'fragment':'unsupported-link';
   if(a&&href){try{const u=new URL(href,location.href),params=[...u.searchParams];if(u.origin===location.origin&&u.pathname===location.pathname&&!u.hash&&!u.username&&!u.password&&params.length===1&&/^(?:jobId|postingId|id)$/i.test(params[0][0])&&params[0][1]===e.schoolId){url=u.href;kind='observed-direct-link';}}catch{}}
   if(mode==='source-target'){
    if(!a)return stop('SOURCE_TITLE_AMBIGUOUS');
    const handler=a.getAttribute('onclick')||'';if(handler.length>4096)return stop('HANDLER_SIZE_LIMIT');
    const match=handler.match(/^\s*(?:return\s+)?([A-Za-z_$][\w$]{0,63})\.([A-Za-z_$][\w$]{0,63})\s*\(/);if(!match)return stop('HANDLER_SHAPE_CHANGED');
    const assets=[],excluded={crossOrigin:0,queryRejected:0,nonJavaScript:0,invalid:0,duplicate:0,fileLimit:0};
    for(const script of document.querySelectorAll('script[src]')){try{const src=script.getAttribute('src'),u=new URL(src,location.href);if(u.origin!==location.origin){excluded.crossOrigin++;continue;}if(u.hash||u.username||u.password){excluded.invalid++;continue;}if(!u.pathname.toLowerCase().endsWith('.js')){excluded.nonJavaScript++;continue;}const params=[...u.searchParams];if(params.length>1||params.some(([k,v])=>!['v','ver','version','build'].includes(k)||!/^\d{1,12}(?:\.\d{1,6}){0,4}$/.test(v)||v.length>32)){excluded.queryRejected++;continue;}if(assets.includes(u.href)){excluded.duplicate++;continue;}assets.push(u.href);}catch{excluded.invalid++;}}
    const priority=url=>{const base=new URL(url).pathname.split('/').pop().toLowerCase();if([match[1],match[2]].some(x=>base.includes(x.toLowerCase())))return 0;return /^(jquery|bootstrap|angular|react|lodash|moment|polyfill|vendor)(?:[-.\d]|$)/.test(base)?2:1;};assets.sort((a,b)=>priority(a)-priority(b));excluded.fileLimit=Math.max(0,assets.length-12);return {ok:true,titleSource:{handler,assets:assets.slice(0,12),excluded}};
   }
   const evidence=titleEvidence(a,href,e.schoolId);
   routes.push({evidence,entry:{schoolId:e.schoolId,title:e.title,company:e.company,term:e.term},supported:Boolean(url),url,kind,targets:targets.length,target:a?.getAttribute('target')==='_blank'?'new-tab':a?.getAttribute('target')?'named':'same-tab',inline:Boolean(a&&['onclick','onpointerdown','onmousedown','onkeydown'].some(k=>a.getAttribute(k)!==null))});
  }return {ok:true,routes};
 }
 if(mode!=='scan')return stop('INVALID_ACTION');
 return {ok:true,entries:entries.map(e=>({schoolId:e.id,title:e.title,company:e.company,term:e.term}))};
}
