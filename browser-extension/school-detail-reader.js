// Serialized into the isolated world. Only visible allowlisted job fields are read.
export function schoolDetailReader(expected=null,options={}){
 const stop=code=>({ok:false,code});
 if(location.origin!=='https://recruitstudents.torontomu.ca'||location.pathname!=='/myAccount/coop/postings.htm')return stop('PORTAL_CHANGED');
 const visible=e=>Boolean(e?.getClientRects().length)&&getComputedStyle(e).visibility!=='hidden'&&!e.closest('[hidden],[aria-hidden=true]');
 if([...document.querySelectorAll('input[type=password],iframe[title*=captcha i],iframe[title*=challenge i]')].some(visible))return stop('VISIBLE_AUTH_CHALLENGE');
 const excluded='input,textarea,select,option,script,style,noscript,nav,header,footer,aside,[contenteditable=true],[hidden],[aria-hidden=true]';
 const clean=s=>s.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[email removed]').replace(/\b(?:token|password|session|authorization)\s*[:=]\s*\S+/gi,'[private value removed]').replace(/\s+/g,' ').trim();
 let overLimit=false;
 function text(e,max=200000,strict=true,prefix=false){let value='';const w=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);for(let n=w.nextNode();n;n=w.nextNode()){const p=n.parentElement;if(!p||!visible(p)||p.closest(excluded))continue;value+=' '+n.textContent.replace(/\s+/g,' ').trim();if(value.length>max){if(strict)overLimit=true;return prefix?clean(value.slice(0,max)):'';}}return clean(value);}
 const allowed=/^(?:job posting status|term posted|job duration|co-op student position title|job title|position title|job description|responsibilities|qualifications|requirements|application instructions|application procedure|application method|application deadline|organization|organization name|employer|company|job id|posting id|job posting id)$/i;
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
 if(options.currentPage){
  const values=p=>[...new Set(fields.filter(f=>p.test(f.label)).map(f=>f.value))];
  if([/^(?:co-op student position title|job title|position title)$/i,/^term posted$/i,/^(?:organization|organization name|employer|company)$/i,/^(?:job id|posting id|job posting id)$/i,/^job duration$/i,/^job description$/i].some(p=>values(p).length>1))return stop('DETAIL_IDENTITY_CONFLICT');
  if(!title||!company||!term)return stop('DETAIL_IDENTITY_INCOMPLETE');
  if(!expected){if(!/^\d{4,10}$/.test(ownId||''))return stop('LIST_BINDING_REQUIRED');expected={schoolId:ownId,title,company,term};}
  if(!/^\d{4,10}$/.test(expected.schoolId||''))return stop('DETAIL_IDENTITY_INCOMPLETE');
 }
 if(!expected)return stop('LIST_BINDING_REQUIRED');
 const exact=title===expected.title&&companyKey(company)===companyKey(expected.company)&&termKey(term)===termKey(expected.term);
 const idValid=ownId===null||ownId===expected.schoolId;
 if(options.currentPage&&(!exact||!idValid))return stop('DETAIL_IDENTITY_MISMATCH');
 return {ok:true,schema:'career-queue-school-visible-detail-v1',capturedAt:new Date().toISOString(),origin:location.origin,page:{path:location.pathname},expected:{schoolId:expected.schoolId,title:expected.title,company:expected.company,term:expected.term},identity:{verified:exact&&idValid,basis:ownId?'visible-id-and-exact-fields':(options.currentPage?'saved-list-and-exact-title-employer-term':'clicked-unique-row-and-exact-title-employer-term'),visibleSchoolId:ownId,title,company,term},fields,jd,duration:one(/^job duration$/i)||'',applicationInstructions:one(/^(?:application instructions|application procedure)$/i)||'',capture:{scope:'recognized-visible-job-fields',completeWithinScope:true,truncated:false,hiddenOrCollapsedRead:false}};
}
