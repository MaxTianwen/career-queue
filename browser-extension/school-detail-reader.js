// Serialized into the isolated world. Only visible allowlisted job fields are read.
export function schoolDetailReader(expected,options={}){
 const stop=code=>({ok:false,code});
 if(location.origin!=='https://recruitstudents.torontomu.ca'||location.pathname!=='/myAccount/coop/postings.htm')return stop('PORTAL_CHANGED');
 const visible=e=>Boolean(e?.getClientRects().length)&&getComputedStyle(e).visibility!=='hidden'&&!e.closest('[hidden],[aria-hidden=true]');
 if([...document.querySelectorAll('input[type=password],iframe[title*=captcha i],iframe[title*=challenge i]')].some(visible))return stop('VISIBLE_AUTH_CHALLENGE');
 const excluded='input,textarea,select,option,script,style,noscript,nav,header,footer,aside,[contenteditable=true],[hidden],[aria-hidden=true]';
 const clean=s=>s.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[email removed]').replace(/\b(?:token|password|session|authorization)\s*[:=]\s*\S+/gi,'[private value removed]').replace(/\s+/g,' ').trim();
 let overLimit=false;
 function text(e,max=200000,strict=true,prefix=false){let value='';const w=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);for(let n=w.nextNode();n;n=w.nextNode()){const p=n.parentElement;if(!p||!visible(p)||p.closest(excluded))continue;value+=' '+n.textContent.replace(/\s+/g,' ').trim();if(value.length>max){if(strict)overLimit=true;return prefix?clean(value.slice(0,max)):'';}}return clean(value);}
 const allowed=/^(?:job posting status|term posted|job duration|co-op student position title|job title|position title|job description|responsibilities|qualifications|requirements|application instructions|application procedure|application deadline|organization|organization name|employer|company|job id|posting id|job posting id)$/i;
 if(options.identityOnly){
  const metadata=[],jdCells=[];
  for(const row of document.querySelectorAll('tr,[role=row]')){if(!visible(row))continue;const cells=[...row.children].filter(e=>/^(TD|TH)$/.test(e.tagName)||['cell','gridcell'].includes(e.getAttribute('role')));if(cells.length!==2)continue;const label=text(cells[0],300,false).replace(/:$/,'').trim();
   if(/^job description$/i.test(label)){jdCells.push(cells[1]);continue;}
   if(!/^(?:term posted|co-op student position title|job title|position title|organization|organization name|employer|company|job id|posting id|job posting id)$/i.test(label))continue;
   const value=text(cells[1],1000,false);if(value)metadata.push({label,value});
  }
  const values=p=>[...new Set(metadata.filter(f=>p.test(f.label)).map(f=>f.value))];
  const titles=values(/^(?:co-op student position title|job title|position title)$/i),terms=values(/^term posted$/i),companies=values(/^(?:organization|organization name|employer|company)$/i),ids=values(/^(?:job id|posting id|job posting id)$/i);
  const termKey=s=>clean(s||'').replace(/^(20\d{2})\s*-\s*(Summer|Fall|Winter)$/,'$2 $1'),companyKey=s=>clean(s||'').replace(/\s*\(RCMP\)$/,'');
  const checks={titlePresent:titles.length===1,termPresent:terms.length===1,employerPresent:companies.length===1,visibleIdPresent:ids.length>0};
  if([titles,terms,companies,ids].some(v=>v.length>1))return {ok:false,code:'DETAIL_IDENTITY_CONFLICT',checks};
  if(!checks.titlePresent||!checks.termPresent)return {ok:false,code:'DETAIL_IDENTITY_INCOMPLETE',checks};
  if(titles[0]!==expected.title||termKey(terms[0])!==termKey(expected.term)||ids.length&&ids[0]!==expected.schoolId)return {ok:false,code:'DETAIL_IDENTITY_MISMATCH',checks};
  // Only after title/term/available ID match, inspect a bounded visible employer prefix.
  const company=companies[0]||(jdCells.length===1?text(jdCells[0],2500,false,true).match(/\bEmployer:\s*(.+?)\s+(?:Branch Name|Term)\s*:/i)?.[1]:null);
  checks.employerPresent=Boolean(company);
  if(!company)return {ok:false,code:'DETAIL_IDENTITY_INCOMPLETE',checks};
  if(companyKey(company)!==companyKey(expected.company))return {ok:false,code:'DETAIL_IDENTITY_MISMATCH',checks};
  return {ok:true,schema:'career-queue-school-identity-v1',verified:true,checks,origin:location.origin,identity:{title:titles[0],company,term:terms[0],visibleSchoolId:ids[0]||null,basis:ids.length?'explicit-current-tab-visible-id-and-exact-fields':'explicit-current-tab-exact-title-employer-term'}};
 }
 if(options.requireVerified){const probe=schoolDetailReader(expected,{identityOnly:true});if(!probe.ok)return probe;}
 const fields=[];
 for(const row of document.querySelectorAll('tr,[role=row]')){if(!visible(row))continue;const cells=[...row.children].filter(e=>/^(TD|TH)$/.test(e.tagName)||['cell','gridcell'].includes(e.getAttribute('role')));if(cells.length!==2)continue;
  const label=text(cells[0],300,false).replace(/:$/,'').trim();if(!allowed.test(label))continue;const value=text(cells[1]);if(value)fields.push({label,value});
 }
 // A recognized field above the limit must never be reported as a full capture.
 if(overLimit)return stop('VISIBLE_FIELD_TOO_LARGE');
 const one=pattern=>{const values=[...new Set(fields.filter(f=>pattern.test(f.label)).map(f=>f.value))];return values.length===1?values[0]:null;};
 const title=one(/^(?:co-op student position title|job title|position title)$/i),jd=one(/^job description$/i);
 if(!title||!jd){
  const frames={sameOrigin:0,other:0};for(const frame of document.querySelectorAll('iframe')){if(!visible(frame))continue;try{const u=new URL(frame.getAttribute('src')||'',location.href);frames[u.origin===location.origin?'sameOrigin':'other']++;}catch{frames.other++;}}
  return {ok:false,code:'WAITING_FOR_DETAIL',fieldCount:fields.length,recognizedLabels:[...new Set(fields.map(f=>f.label))].slice(0,24),frames};
 }
 const term=one(/^term posted$/i),company=one(/^(?:organization|organization name|employer|company)$/i)||jd.match(/\bEmployer:\s*(.+?)\s+(?:Branch Name|Term)\s*:/i)?.[1]||null;
 const ownId=one(/^(?:job id|posting id|job posting id)$/i);const companyKey=s=>clean(s||'').replace(/\s*\(RCMP\)$/,'');const termKey=s=>clean(s||'').replace(/^(20\d{2})\s*-\s*(Summer|Fall|Winter)$/,'$2 $1');
 const exact=title===expected.title&&companyKey(company)===companyKey(expected.company)&&termKey(term)===termKey(expected.term);
 const idValid=ownId===null||ownId===expected.schoolId;
 const safe=s=>/^[A-Za-z][A-Za-z_-]{0,39}$/.test(s)&&!/token|session|auth|account|secret|password/i.test(s);
 const returnControls=[];
 for(const e of document.querySelectorAll('a,button,[role=button]')){if(!visible(e))continue;const label=clean(text(e,500)||e.getAttribute('aria-label')||'');if(!/^(?:back|back to (?:job postings|postings|search results|job search)|return to (?:job postings|postings|search results)|close|返回|返回列表|关闭)$/i.test(label))continue;
  returnControls.push({label,tag:e.tagName,role:['link','button'].includes(e.getAttribute('role'))?e.getAttribute('role'):null,id:safe(e.id||'')?e.id:null,classes:[...e.classList].filter(safe).slice(0,6)});if(returnControls.length===12)break;
 }
 return {ok:true,schema:'career-queue-school-visible-detail-v1',capturedAt:new Date().toISOString(),origin:location.origin,page:{path:location.pathname},expected:{schoolId:expected.schoolId,title:expected.title,company:expected.company,term:expected.term},identity:{verified:exact&&idValid,basis:ownId?'visible-id-and-exact-fields':'clicked-unique-row-and-exact-title-employer-term',visibleSchoolId:ownId,title,company,term},fields,jd,duration:one(/^job duration$/i)||'',applicationInstructions:one(/^(?:application instructions|application procedure)$/i)||'',capture:{scope:'recognized-visible-job-fields',completeWithinScope:true,truncated:false,hiddenOrCollapsedRead:false},returnControls};
}
