const norm=x=>String(x||'').trim().replace(/\s+/g,' ');
const term=x=>norm(x).replace(/^(20\d{2})\s*-\s*(Summer|Fall|Winter)$/,'$2 $1');
const fail=()=>{throw Error('Unverified or mismatched school trial; no import');};
export function schoolApplicationInstructions(jd,explicit=''){
 if(norm(explicit))return norm(explicit);
 return norm(jd).match(/^(?:NOTE:\s*)?(Please apply both externally and internally \(co-op portal\)\.[\s\S]{0,1500}?)(?=\s+(?:Position Overview|Responsibilities|Qualifications):|$)/i)?.[1]||'';
}
// Converts verified read evidence only. Submission observations/history are never imported here.
export function trialCapturePacket(store,owner,trial){
 const e=trial?.entry,d=trial?.detail;if(trial?.schema!=='career-queue-school-read-trial-v1'||d?.schema!=='career-queue-school-visible-detail-v1'||d.ok!==true||d.identity?.verified!==true||trial.automaticReturn!==false)fail();
 if(d.origin!=='https://recruitstudents.torontomu.ca'||d.page?.path!=='/myAccount/coop/postings.htm'||d.capture?.scope!=='recognized-visible-job-fields'||d.capture?.completeWithinScope!==true||d.capture?.truncated!==false||d.capture?.hiddenOrCollapsedRead!==false||!Number.isFinite(Date.parse(d.capturedAt))||!d.jd?.trim())fail();
 if(!/^\d{4,10}$/.test(e?.schoolId)||e.candidateCount!==1)fail();
 const known=store.schoolOpportunities(owner).filter(r=>r.schoolId===e.schoolId);if(known.length!==1)fail();
 for(const identity of [known[0].row,d.expected,d.identity])if(!identity||norm(identity.title)!==norm(e.title)||norm(identity.company)!==norm(e.company)||term(identity.term)!==term(e.term))fail();
 if(d.expected.schoolId!==e.schoolId||d.identity.visibleSchoolId!=null&&d.identity.visibleSchoolId!==e.schoolId)fail();
 const field=pattern=>[...new Set((d.fields||[]).filter(f=>pattern.test(f.label)).map(f=>norm(f.value)))];
 const jds=field(/^job description$/i),durations=field(/^job duration$/i);if(jds.length!==1||jds[0]!==norm(d.jd)||durations.length!==1||durations[0]!==norm(d.duration))fail();
 const employers=field(/^(?:organization|organization name|employer|company)$/i),titles=field(/^(?:co-op student position title|job title|position title)$/i),terms=field(/^term posted$/i);
 if(employers.length!==1||employers[0]!==norm(e.company)||titles.length!==1||titles[0]!==norm(e.title)||terms.length!==1||term(terms[0])!==term(e.term))fail();
 return {schema:'career-queue-school-capture-v1',jobs:[{schoolId:e.schoolId,url:d.origin+d.page.path,title:e.title,company:e.company,status:'done',jd:d.jd,duration:d.duration,applicationInstructions:schoolApplicationInstructions(d.jd,d.applicationInstructions),capturedAt:d.capturedAt}]};
}
