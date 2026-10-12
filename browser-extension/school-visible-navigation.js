// Self-contained activeTab function. No event code, credentials, hidden values or APIs.
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
   const candidates=[...titleCell.querySelectorAll('a,button,[role=link],[tabindex]')].filter(e=>visible(e)&&text(e)===title&&!e.closest('form')&&!(e.tagName==='BUTTON'&&e.type==='submit'));
   // Ambiguous or nonsemantic cells are diagnostic only; never infer event handlers.
   entries.push({id,title,company:text(cs[at('Organization')]||titleCell),term:text(cs[at('Term')]||titleCell),candidates,titleCell});
  }
 }
 const safe=x=>/^[A-Za-z][A-Za-z_-]{0,39}$/.test(x)&&!/token|session|auth|user|account|secret|password/i.test(x);
 const meta=n=>({tag:n.tagName,role:['link','button','cell','gridcell'].includes(n.getAttribute('role'))?n.getAttribute('role'):null,id:safe(n.id||'')?n.id:null,classes:[...n.classList].filter(safe).slice(0,6)});
 const receiptKey='__careerQueueSchoolClickReceipt';
 if(mode==='receipt')return {ok:true,receipt:globalThis[receiptKey]||null,listVisible:entries.length>0};
 if(mode==='scan')return {ok:true,entries:entries.map(e=>({schoolId:e.id,title:e.title,company:e.company,term:e.term,candidateCount:e.candidates.length,cell:meta(e.titleCell),titleElements:[...e.titleCell.querySelectorAll('*')].filter(n=>visible(n)&&text(n)===e.title).slice(0,4).map(meta),targets:e.candidates.slice(0,3).map(meta)}))};
 if(mode!=='open'||!expected)return stop('INVALID_ACTION');
 const matches=entries.filter(e=>e.id===expected.schoolId&&e.title===expected.title&&e.company===expected.company&&e.term===expected.term);
 if(matches.length!==1||matches[0].candidates.length!==1)return stop('AMBIGUOUS_TITLE_TARGET');
 const target=matches[0].candidates[0];
 if(target.tagName!=='A'||target.getAttribute('role')!=='button')return stop('UNOBSERVED_TITLE_TARGET');
 if(target.tagName==='A'){const href=target.getAttribute('href');if(href&&href!=='#'&&!/^javascript:\s*(?:void\s*\(\s*0\s*\)|;)\s*;?\s*$/i.test(href)){let u;try{u=new URL(href,location.href);}catch{return stop('UNSAFE_TITLE_TARGET');}if(u.protocol!=='https:'||u.origin!==location.origin||u.username||u.password)return stop('UNSAFE_TITLE_TARGET');}}
 const old=globalThis[receiptKey];
 if(expected.attemptId&&old?.attemptId===expected.attemptId)return {ok:true,clickDispatched:true,alreadyDispatched:true};
 const clickEvidence={eventObserved:false,isTrusted:null,userActivationAtDispatch:globalThis.navigator?.userActivation?.isActive??null,defaultPrevented:null};let clickEvent;
 const observe=event=>{clickEvent=event;clickEvidence.eventObserved=true;clickEvidence.isTrusted=event.isTrusted===true;};
 if(expected.attemptId)globalThis[receiptKey]={attemptId:expected.attemptId,schoolId:expected.schoolId,clickDispatched:true,clickEvidence};
 target.addEventListener?.('click',observe,{capture:true,once:true});
 try{target.click();}finally{target.removeEventListener?.('click',observe,true);if(clickEvent)clickEvidence.defaultPrevented=clickEvent.defaultPrevented===true;}
 return {ok:true,clickDispatched:true,clickedSchoolId:expected.schoolId,requiresDetailVerification:true,clickEvidence};
}
