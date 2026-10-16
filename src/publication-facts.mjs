// Publication observations only: never derive publication from collection/update times.
export function validPublicationInstant(value) {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(value))return false;
 return validDay(value.slice(0,10))&&Number.isFinite(Date.parse(value));
}
function validDay(s){if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const[y,m,d]=s.split('-').map(Number);return m>=1&&m<=12&&d>=1&&d<=new Date(Date.UTC(y,m,0)).getUTCDate();}
export function publicationFacts(job={},now=Date.now()) {
 const evidence=job.sourceEvidence||{},field=evidence.postedAtField||'';
 const kind=job.postedAtKind||(/first_published/i.test(field)?'first':/publishedAt|lastPublishedAt/i.test(field)?'latest':'official');
 const raw=String(job.postedAt||evidence.lastPublishedAt||'');
 const rejected=/updated|modified|first.?seen|retrieved|createdAt/i.test(field);
 const precision=rejected?'unknown':validPublicationInstant(raw)?'instant':validDay(raw)?'date':raw?'unresolved':'unknown';
 const instant=precision==='instant'?Date.parse(raw):null,age=instant===null?null:Number(now)-instant;
 return {raw,kind,precision,instant,recent24h:age!==null&&age>=0&&age<=86400000,future:age!==null&&age<0,sourceUrl:evidence.publicationUrl||evidence.url||job.url||'',sourceField:field,firstSeenAt:job.firstSeenAt||null,updatedAt:evidence.updatedAt||null};
}
export function publicationLabel(job,now=Date.now()) {
 const p=publicationFacts(job,now),label=p.kind==='first'?'首次发布':p.kind==='latest'?'最近发布（可能含重新发布）':'官方发布';
 if(p.precision==='unknown')return '发布时间未知';
 if(p.precision==='date')return `${label}：${p.raw}（仅日期，24 小时范围待确认）`;
 if(p.precision==='unresolved')return `${label}：${p.raw}（时间或时区不精确，24 小时范围待确认）`;
 const local=new Intl.DateTimeFormat('zh-CN',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',timeZoneName:'short'}).format(new Date(p.instant));
 return `${label}：${local} · Toronto${p.future?'（未来时间，待核实）':''}`;
}
// New observations keep provenance. Missing data cannot erase a known publication.
export function mergePublication(incoming,previous,now) {
 const old=previous||{},next=publicationFacts(incoming),prior=publicationFacts(old);
 const fresh=next.precision!=='unknown',chosen=fresh?incoming:old;
 let postedAt=chosen.postedAt||null,postedAtKind=publicationFacts(chosen).kind;
 const firstPublishedAt=old.firstPublishedAt||(prior.kind==='first'?old.postedAt:null)||(next.kind==='first'?incoming.postedAt:null)||null;
 if(postedAtKind==='first'&&firstPublishedAt)postedAt=firstPublishedAt;
 return {postedAt,postedAtKind,firstPublishedAt,firstSeenAt:previous?(old.firstSeenAt||null):new Date(now).toISOString(),publicationEvidence:fresh?(incoming.publicationEvidence||{...incoming.sourceEvidence}):(old.publicationEvidence||{...old.sourceEvidence})};
}
