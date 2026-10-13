const norm=x=>String(x||'').trim().replace(/\s+/g,' '),term=x=>norm(x).replace(/^(20\d{2})\s*-\s*(Summer|Fall|Winter)$/,'$2 $1');
const company=x=>norm(x).replace(/\s*\(RCMP\)$/,'');
const fail=()=>{throw Object.assign(Error('当前页证据不完整或与本账号岗位不一致，请重新核对后导入'),{status:400})};
export function currentCapturePacket(store,owner,p){
 if(JSON.stringify(p).length>800000)fail();
 const e=p?.entry,d=p?.detail;if(p?.schema!=='career-queue-school-current-page-v1'||p.automaticReturn!==false||d?.ok!==true||d.schema!=='career-queue-school-visible-detail-v1'||!d.identity?.verified||!/^\d{4,10}$/.test(e?.schoolId))fail();
 if(d.origin!=='https://recruitstudents.torontomu.ca'||d.page?.path!=='/myAccount/coop/postings.htm'||d.capture?.scope!=='recognized-visible-job-fields'||d.capture.completeWithinScope!==true||d.capture.truncated!==false||d.capture.hiddenOrCollapsedRead!==false||!Number.isFinite(Date.parse(d.capturedAt))||!d.jd?.trim()||!Array.isArray(d.fields)||d.fields.length>200||d.fields.some(f=>!f||typeof f.label!=='string'||typeof f.value!=='string'))fail();
 const rows=store.schoolOpportunities(owner).filter(r=>r.schoolId===e.schoolId);if(rows.length!==1)fail();
 for(const x of [rows[0].row,d.expected,d.identity])if(!x||norm(x.title)!==norm(e.title)||company(x.company)!==company(e.company)||term(x.term)!==term(e.term))fail();
 if(d.expected.schoolId!==e.schoolId||d.identity.visibleSchoolId!=null&&d.identity.visibleSchoolId!==e.schoolId)fail();
 const fields=re=>[...new Set(d.fields.filter(f=>re.test(f.label)).map(f=>norm(f.value)))];
 function exact(re,value,optional=false){const values=fields(re);if(optional&&!value&&!values.length)return;if(values.length!==1||values[0]!==norm(value))fail();}
 exact(/^job description$/i,d.jd);exact(/^job duration$/i,d.duration,true);exact(/^(?:co-op student position title|job title|position title)$/i,e.title);const terms=fields(/^term posted$/i);if(terms.length!==1||term(terms[0])!==term(e.term))fail();
 const companies=fields(/^(?:organization|organization name|employer|company)$/i),fallback=norm(d.jd).match(/\bEmployer:\s*(.+?)\s+(?:Branch Name|Term)\s*:/i)?.[1];if(companies.length?companies.length!==1||company(companies[0])!==company(e.company):company(fallback)!==company(e.company))fail();
 const ids=fields(/^(?:job id|posting id|job posting id)$/i);if(d.identity.visibleSchoolId?(ids.length!==1||ids[0]!==e.schoolId):ids.length)fail();
 if(!['visible-id-and-exact-fields','saved-list-and-exact-title-employer-term'].includes(d.identity.basis))fail();
 exact(/^(?:application instructions|application procedure)$/i,d.applicationInstructions,true);
 // Preserve explicit user channel confirmation. Newly read instructions remain in source evidence.
 const sections=d.fields.filter(f=>/^(?:responsibilities|qualifications|requirements)$/i.test(f.label)&&norm(f.value));const fullJd=[d.jd,...sections.map(f=>f.label+': '+f.value)].join('\n\n');
 const original=rows[0].row.applicationInstructions||'',confirmed=/用户.*确认|仅学校\s*Portal/i.test(original);
 return {schema:'career-queue-school-capture-v1',jobs:[{schoolId:e.schoolId,url:d.origin+d.page.path,title:e.title,company:e.company,term:e.term,status:'done',jd:fullJd,duration:d.duration||'',applicationInstructions:confirmed?original:d.applicationInstructions||'',capturedAt:d.capturedAt,currentPageEvidence:{identityBasis:d.identity.basis,term:e.term,duration:d.duration||'',applicationInstructions:d.applicationInstructions||'',applicationMethod:fields(/^application method$/i).join(' | ')}}]};
}
