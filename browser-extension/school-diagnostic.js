// Executed only after the user clicks the existing activeTab extension.
// No page code, requests, credentials, form values or browser storage are read.
export function schoolDiagnostic(kind) {
 let stage='preflight';
 const stop=code=>({schema:'career-queue-school-diagnostic-error-v1',ok:false,stage,code});
 try {
 if(!['list','detail'].includes(kind))return stop('INVALID_KIND');
 if(location.protocol!=='https:')return stop('HTTPS_REQUIRED');
 const visible=e=>Boolean(e?.getClientRects().length)&&getComputedStyle(e).visibility!=='hidden';
 if([...document.querySelectorAll('input[type=password],iframe[title*=captcha i],iframe[title*=challenge i]')].some(visible))return stop('VISIBLE_AUTH_CHALLENGE');
 stage='structure';
 const blocked='input,textarea,select,option,script,style,noscript,nav,header,footer,aside,[contenteditable=true],[hidden],[aria-hidden=true]';
 const clean=s=>s.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[email removed]').replace(/\b(?:token|password|session|authorization)\s*[:=]\s*\S+/gi,'[private value removed]').trim();
 function text(e,max=5000){let value='';const walk=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);for(let n=walk.nextNode();n&&value.length<max;n=walk.nextNode()){const p=n.parentElement;if(p&&!p.closest(blocked)&&visible(p))value+=' '+n.textContent.replace(/\s+/g,' ').trim();}return clean(value).slice(0,max);}
 function address(value){try{const u=new URL(value,location.href);if(u.protocol!=='https:'||u.origin!==location.origin||u.username||u.password)return null;const path=u.pathname.replace(/[A-Za-z0-9_-]{24,}/g,'[opaque]');const ids=[...u.searchParams].filter(([k,v])=>/^(?:job|posting|position)?id$/i.test(k)&&/^\d{1,10}$/.test(v));return {path,ids:Object.fromEntries(ids)};}catch{return null;}}
 const headings=[...document.querySelectorAll('h1,h2,h3,h4,legend,[role=heading]')].filter(visible).map(e=>text(e,160)).filter(s=>/job|posting|position|description|qualification|responsibilit|work term|employment|岗位|职位/i.test(s)).slice(0,25);
 const rows=[];for(const e of document.querySelectorAll('tr,[role=row]')){if(!visible(e))continue;const value=text(e,kind==='detail'?60000:5000);if(/student (?:id|number)|first name|last name|my profile|\bgpa\b|password|phone number/i.test(value))continue;if(!/\b\d{4,10}\b|job (?:id|title|description)|posting|qualification|responsibilit|duration|work term|application instructions/i.test(value))continue;rows.push({text:value,links:[...e.querySelectorAll('a[href]')].filter(visible).map(a=>({text:text(a,160),address:address(a.getAttribute('href'))})).filter(a=>a.address).slice(0,12)});if(rows.length>=60)break;}
 const sections=[];if(kind==='detail')for(const h of document.querySelectorAll('h1,h2,h3,h4,dt')){const label=text(h,160);if(!/^(?:job description|responsibilities|qualifications|requirements|application instructions|work term|duration|job details|position details)\s*:?$/i.test(label))continue;let n=h.nextElementSibling,value='';while(n&&!/^H[1-4]$/.test(n.tagName)&&value.length<12000){value+='\n'+text(n,12000-value.length);n=n.nextElementSibling;}sections.push({label,text:value.trim()});}
 const frameCount=[...document.querySelectorAll('iframe')].filter(visible).length;
 if(!headings.length&&!rows.length&&!sections.some(s=>s.text)){const result=stop(frameCount?'FRAME_CONTENT_UNREAD':'NO_JOB_STRUCTURE');return {...result,structure:{headings:headings.length,rows:rows.length,sections:sections.length,visibleFrames:Math.min(frameCount,20)}};}
 stage='result';
 return {schema:'career-queue-school-diagnostic-v1',kind,capturedAt:new Date().toISOString(),captureLimits:{rowTextChars:kind==='detail'?60000:5000,completeness:'bounded-visible-excerpt'},page:address(location.href),origin:location.origin,headings,rows,sections,limitations:['仅当前可见岗位结构；未展开、翻页、点击链接或读取隐藏字段','链接仅保留路径及数字岗位ID；不是可执行抓取计划','尚未适配此Portal，也未导入岗位']};
 }catch{return stop('DOM_READ_FAILED');}
}
