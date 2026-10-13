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
   entries.push({id,title,company:text(cs[at('Organization')]||titleCell),term:text(cs[at('Term')]||titleCell),titleCell});
  }
 }
 if(mode!=='scan')return stop('INVALID_ACTION');
 return {ok:true,entries:entries.map(e=>({schoolId:e.id,title:e.title,company:e.company,term:e.term}))};
}
