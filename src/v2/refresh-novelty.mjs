import {projectAliases} from './opportunity-aliases.mjs';
// Public catalogue identities only. Never store owner/private school records here.
export function refreshNovelty(previous,value,runId,now,mappings=[]){
 const seen=new Set([...(previous.discoveryHistory?.seenIds||[]),...previous.jobs.map(j=>j.id)]),startedAt=previous.discoveryHistory?.startedAt||new Date(now).toISOString();
 const successful=new Set(value.sources.filter(s=>['complete','partial'].includes(s.status)).map(s=>s.id));
 const fresh=[...new Set(projectAliases(value.jobs,mappings).filter(j=>!seen.has(j.id)&&!(j.publicAliases||[]).some(a=>seen.has(a.id))&&(j.sources||[j.source]).some(s=>successful.has(s?.id))).map(j=>j.id))].sort();
 for(const j of value.jobs)seen.add(j.id);
 // If bounded history cannot prove novelty, fail closed instead of forgetting old identities.
 const complete=previous.discoveryHistory?.complete!==false&&seen.size<=100000;
 return {discoveryHistory:{startedAt,complete,seenIds:[...seen].slice(0,100000)},refreshBatch:{id:runId,finishedAt:new Date(now).toISOString(),startedAt,historyComplete:complete,newIds:complete?fresh:[],partial:value.sources.some(s=>s.status!=='complete')}};
}
