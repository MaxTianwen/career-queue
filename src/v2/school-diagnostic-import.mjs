import {createHash,randomUUID} from 'node:crypto';
const norm=x=>String(x??'').replace(/\s+/g,' ').trim();
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fail=s=>{throw Error(s);};
function packet(input,kind){const p=input?.packet;if(p?.schema!=='career-queue-school-diagnostic-v1'||p.kind!==kind||p.origin!=='https://recruitstudents.torontomu.ca'||p.page?.path!=='/myAccount/coop/postings.htm'||!Array.isArray(p.rows)||p.rows.length>100||!input.library_file_id||!Number.isFinite(Date.parse(p.capturedAt)))fail('Unsupported or incomplete school evidence');return p;}
export function diagnosticPlan(store,owner,inputs){
 const li=inputs.find(x=>x.packet?.kind==='list'),de=inputs.find(x=>x.packet?.kind==='detail');const list=packet(li,'list');
 const known=store.schoolOpportunities(owner),rows=[],ids=new Set();
 for(const source of list.rows){const text=norm(source.text);if(text==='App Status Term ID Job Title Organization Openings Location App Deadline')continue;
  const m=text.match(/^Shortlist (Applied Application Submitted|Apply) (20\d{2}) - (Summer|Fall|Winter) (\d{4,10}) (?:NEW )?(.+)$/);if(!m)fail('Unrecognized list row; no partial import');
  const schoolId=m[4],term=m[3]+' '+m[2];if(ids.has(schoolId))fail('Duplicate school ID');ids.add(schoolId);
  const current=known.find(x=>x.schoolId===schoolId);if(!current)fail('Unknown school ID '+schoolId);
  const identity=norm(current.row.title)+' '+norm(current.row.company)+' ';
  if(!m[5].startsWith(identity)||norm(current.row.term)!==term)fail('School identity mismatch '+schoolId);
  const submitted=m[1]==='Applied Application Submitted';rows.push({schoolId,title:current.row.title,company:current.row.company,term,submitted,text,before:current.row,after:current.row});
 }
 const evidence={kind:'school-diagnostic-library',libraryFileId:li.library_file_id,capturedAt:list.capturedAt,sha256:hash(list)};
 const observed=new Set(store.db.prepare('SELECT school_id FROM portal_submission_observations WHERE user_id=?').all(owner).map(r=>r.school_id));
 for(const row of rows)if(row.submitted&&(!observed.has(row.schoolId)||row.before.sourceStatus!=='Application Submitted'))row.after={...row.before,sourceStatus:'Application Submitted',portalDiagnosticEvidence:{...evidence,observedText:row.text}};
 let detailMatch=null;
 if(de){const detail=packet(de,'detail');const field=label=>{const values=detail.rows.map(r=>norm(r.text)).filter(s=>s.startsWith(label+':')).map(s=>s.slice(label.length+1).trim());if(values.length!==1)fail('Missing or ambiguous detail field '+label);return values[0];};
  const title=field('Co-op Student Position Title'),term=field('Term Posted').replace(/^(20\d{2}) - (\w+)$/,'$2 $1'),jd=field('Job Description');
  const employer=jd.match(/\bEmployer:\s*(.+?)\s+Branch Name:/)?.[1];if(!employer)fail('Detail employer not verified');
  const company=x=>norm(x).replace(/\s*\(RCMP\)$/,'');const matches=rows.filter(r=>r.title===title&&r.term===term&&company(r.company)===employer);
  if(matches.length!==1)fail('Detail needs one exact title/employer/term match');const row=matches[0];
  const quote=jd.match(/The successful applicant must be a Canadian Citizen\b[^.]*\./)?.[0];
  detailMatch={schoolId:row.schoolId,basis:'unique-exact-title-employer-term',title,employer,term,libraryFileId:de.library_file_id,capturedAt:detail.capturedAt,sha256:hash(detail),completeness:'partial-diagnostic-not-full-jd'};
  if(quote&&row.before.schoolDiagnosticEvidence?.sha256!==detailMatch.sha256)row.after={...row.after,eligibilityText:quote,duration:field('Job Duration'),schoolDiagnosticEvidence:{...detailMatch,quote},schoolDiagnosticExcerpt:jd};
 }
 const changes=rows.filter(r=>hash(r.before)!==hash(r.after));const submittedIds=rows.filter(r=>r.submitted).map(r=>r.schoolId);
 return {rows:changes,allCount:rows.length,submittedIds,newObservationIds:submittedIds.filter(id=>!observed.has(id)),detailMatch,evidence,fingerprint:hash({rows:rows.map(r=>({id:r.schoolId,before:r.before,after:r.after})),observed:[...observed].sort(),evidence,detailMatch})};
}
export function applyDiagnostic(store,owner,inputs,fingerprint){
 store.db.exec('BEGIN IMMEDIATE');try{const p=diagnosticPlan(store,owner,inputs);if(p.fingerprint!==fingerprint)fail('Stale diagnostic preview');const requestId=randomUUID();
 for(const row of p.rows){const link=store.schoolLinks(owner).find(l=>l.schoolId===row.schoolId);store.schoolAudit(owner,row.schoolId,'update',{schoolId:row.schoolId,jobId:link?.jobId??null,row:row.before},{schoolId:row.schoolId,jobId:link?.jobId??null,row:row.after},'User-authorized Library portal diagnostic import',requestId+':'+row.schoolId,p.fingerprint);store.db.prepare('UPDATE school_opportunities SET snapshot=?,updated=? WHERE user_id=? AND school_id=?').run(JSON.stringify(row.after),store.now(),owner,row.schoolId);if(link)store.db.prepare('UPDATE school_links SET snapshot=? WHERE user_id=? AND school_id=?').run(JSON.stringify(row.after),owner,row.schoolId);}
 const submissions=p.newObservationIds.length?store.importPortalSubmissions(owner,p.newObservationIds,p.evidence):{added:0,existing:0,skipped:0,schoolIds:[]};store.db.exec('COMMIT');return{updated:p.rows.length,submissions,detailMatch:p.detailMatch};
 }catch(e){store.db.exec('ROLLBACK');throw e;}
}
