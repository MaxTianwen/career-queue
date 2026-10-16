// Explicit, reversible display mappings. Source jobs and application records stay intact.
const footer='Not quite ready to apply? Join our talent community to stay up to date on new job opportunities and the latest Autodesk news.';
const body=j=>String(j.jd||'').replace(footer,'').replace(/\s+/g,' ').trim();
export function compatibleAlias(a,b){
 return a&&b&&['company','title','location','term','requisitionId'].every(k=>a[k]&&a[k]===b[k])&&body(a)&&body(a)===body(b);
}
export function readAliases(db){
 return db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='opportunity_aliases'").get()?db.prepare('SELECT canonical_id,alias_id FROM opportunity_aliases ORDER BY alias_id').all():[];
}
export function projectAliases(rows,mappings){
 const result=rows.map(j=>({...j})),removed=new Set();
 for(const m of mappings){
  const canonical=result.find(j=>j.id===m.canonical_id),alias=result.find(j=>j.id===m.alias_id);
  // Changed/missing sources fail open: show both for review instead of hiding a different job.
  if(removed.has(m.canonical_id)||removed.has(m.alias_id)||!compatibleAlias(canonical,alias))continue;
  canonical.publicAliases=[...(canonical.publicAliases||[]),{...alias}];
  canonical.draftIds=[...new Set([...(canonical.draftIds||[]),...(alias.draftIds||[])])];
  canonical.schoolSources=[...(canonical.schoolSources||[]),...(alias.schoolSources||[])].filter((s,i,a)=>a.findIndex(x=>x.schoolId===s.schoolId)===i);
  canonical.hasSchool=canonical.schoolSources.length>0;
  removed.add(alias.id);
 }
 return result.filter(j=>!removed.has(j.id));
}
export function installAliases(db,mappings){
 db.exec('CREATE TABLE IF NOT EXISTS opportunity_aliases(alias_id TEXT PRIMARY KEY,canonical_id TEXT NOT NULL,approved_at TEXT NOT NULL,evidence TEXT NOT NULL)');
 for(const m of mappings){
  const old=db.prepare('SELECT * FROM opportunity_aliases WHERE alias_id=?').get(m.alias_id);
  if(old){if(old.canonical_id!==m.canonical_id||old.evidence!==m.evidence)throw Error('Alias approval conflict');continue;}
  if(m.alias_id===m.canonical_id||db.prepare('SELECT 1 FROM opportunity_aliases WHERE canonical_id=? OR alias_id=?').get(m.alias_id,m.canonical_id))throw Error('Alias cycle or chain');
  db.prepare('INSERT INTO opportunity_aliases VALUES(?,?,?,?)').run(m.alias_id,m.canonical_id,m.approved_at,m.evidence);
 }
}
export function removeAliases(db,mappings){
 for(const m of mappings)db.prepare('DELETE FROM opportunity_aliases WHERE alias_id=? AND canonical_id=? AND evidence=?').run(m.alias_id,m.canonical_id,m.evidence);
}
