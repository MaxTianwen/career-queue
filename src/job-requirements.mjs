// Only explicit requirements for this position; company-wide policies are not job facts.
export function explicitJobRequirements(job) {
 const body=String(job.jd||''), evidence={...job.fieldEvidence}, matches=[];
 const patterns=[
  /\bThis (?:role|position) is (?:categorized as )?(on[ -]?site|hybrid|remote)\b[^\n.!?]*/gi,
  /\bThis role requires the student to work[^\n]{0,100}?\bin an? (on[ -]?site|hybrid|remote) work structure[^\n]*/gi
 ];
 for(const pattern of patterns)for(const m of body.matchAll(pattern)){
  const prefix=body.slice(Math.max(body.lastIndexOf('\n',m.index),body.lastIndexOf('. ',m.index))+1,m.index);
  if(/\b(?:not|no|cannot|can't|may|might|example|whether|if)\b/i.test(prefix)||/\b(?:or|not|may|might|optional)\b/i.test(m[0]))continue;
  matches.push({mode:m[1].toLowerCase().replace(/[ -]/g,''),raw:m[0].trim()});
 }
 const modes=[...new Set(matches.map(x=>x.mode))];
 let workMode=job.workMode||'unknown';
 if(modes.length){
  const conflict=modes.length!==1||(['onsite','hybrid','remote'].includes(workMode)&&workMode!==modes[0]);
  workMode=conflict?'unknown':modes[0];
  evidence.workMode={status:conflict?'ambiguous':'extracted',source:'JD：明确岗位工作要求',raw:matches.map(x=>x.raw).join('\n')};
 }
 // Preserve named alternatives only within the role's explicit reporting obligation.
 const locations=[...body.matchAll(/\bthe successful candidate is expected to report to ([A-Z][A-Za-z ()-]{2,100}?) or ([A-Z][A-Za-z ()-]{2,100}?) (?:\d+|one|two|three|four|five) times per week\b/g)];
 let location=job.location;
 if(locations.length===1){
  const m=locations[0],prefix=body.slice(Math.max(0,m.index-50),m.index);
  if(!/\b(?:not|never|example|if)\b/i.test(prefix)){
   const original=String(location||'');
   location=[original,...[m[1].trim(),m[2].trim()].filter(x=>!original.toLowerCase().includes(x.replace(/\s*\([^)]*\)/g,'').trim().toLowerCase()))].filter(Boolean).join(' / ');
   evidence.location={status:'options',source:'JD：明确到岗地点',raw:m[0],options:[m[1].trim(),m[2].trim()]};
  }
 }
 return {...job,workMode,location,fieldEvidence:evidence};
}
