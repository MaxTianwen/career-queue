const names='January|February|March|April|May|June|July|August|September|October|November|December';
const months=names.toLowerCase().split('|');
const date=(month,day,year)=>{const iso=`${year}-${String(months.indexOf(month.toLowerCase())+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`,d=new Date(iso+'T00:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===iso?iso:null;};
export const seasonForMonth=m=>Number.isInteger(m)&&m>=1&&m<=12?(m<=3?'winter':m<=8?'summer':'fall'):null;
const season=seasonForMonth;
// Extract linked employer choices, never combine independently observed seasons and lengths.
export function internshipOptions(job={}) {
 const out=[];
 for(const [field,text,source] of [['jd',job.jd,job.sourceEvidence],['durationEvidence',job.durationEvidence?.text,job.durationEvidence]]){
  if(!text)continue;const add=(quote,value)=>{if(!out.some(o=>JSON.stringify([o.season,o.months,o.start,o.end])===JSON.stringify([value.season,value.months,value.start,value.end])))out.push({...value,quote,field,sourceUrl:source?.url || job.externalUrl || job.url || '',capturedAt:source?.capturedAt || source?.retrievedAt || null});};
  const sections=[...text.matchAll(/\b(Winter|Summer|Fall)\s+Duration\s*:/gi)];
  for(let i=0;i<sections.length;i++){
   const header=sections[i],block=text.slice(header.index+header[0].length,sections[i+1]?.index ?? text.length);
   const pattern=new RegExp(`\\b(\\d{1,2})\\s+Months?\\s*:\\s*(${names})\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s*,?\\s*(20\\d{2})\\s+(?:to|through)\\s+(${names})\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s*,?\\s*(20\\d{2})`,'gi');
   for(const m of block.matchAll(pattern)){const start=date(m[2],m[3],m[4]),end=date(m[5],m[6],m[7]);if(!start||!end||start>=end||+m[1]<1||+m[1]>24)continue;add(header[0]+' '+m[0],{season:header[1].toLowerCase(),months:{kind:'exact',min:+m[1],max:+m[1]},start,end,precision:'day'});}
  }
  for(const m of text.matchAll(/\b(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?\s*[- ]?months?\s+internship\s*\(starts?\s+([^)]*)\)/gi)){
   const min=+m[1],max=+(m[2]||m[1]);if(min<1||max<min||max>24)continue;
   for(const d of m[3].matchAll(new RegExp(`(${names})\\s+(20\\d{2})`,'gi'))){const start=date(d[1],1,d[2]).slice(0,7);add(m[0],{season:season(months.indexOf(d[1].toLowerCase())+1),months:{kind:m[2]?'range':'exact',min,max},start,end:null,precision:'month'});}
  }
 }
 return out;
}
