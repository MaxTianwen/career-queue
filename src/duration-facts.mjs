import { internshipOptions } from './internship-options.mjs';
const STANDARD=[4,8,12,16];
const clean=s=>String(s||'').replace(/\u00a0/g,' ').trim();
// Values are observations, not inferred co-op slots. Ranges and weeks remain distinct.
export function durationFacts(job={}) {
 const options=new Set(),ranges=[],other=[],evidence=[],review=[],intervals=[];
 const add=(field,quote,value)=>{evidence.push({field,quote:quote.trim(),sourceUrl:(field==='durationEvidence'?job.durationEvidence?.url:null) || job.durationSource?.url || job.sourceEvidence?.url || job.externalUrl || job.url || '',retrievedAt:(field==='durationEvidence'?job.durationEvidence?.capturedAt:null) || job.durationSource?.retrievedAt || job.sourceEvidence?.retrievedAt || job.sourceUpdatedAt || null,...value});};
 const fields=['duration','durationText','term','title','officialTitle','jd','durationEvidence'];
 for(const field of fields){let text=clean(field==='durationEvidence'?job.durationEvidence?.text:job[field]);if(!text)continue;
  // Suspended hyphens denote alternatives, whereas a hyphen between numbers is a range.
  text=text.replace(/\((\d{1,2})\)/g,'$1');
  text=text.replace(/(\d+)\s*-\s*(?=(?:,|or\b|and\b))/gi,'$1 ');
  const pattern=/\b(\d{1,2}(?:\s*(?:months?\s*)?(?:[,/、]\s*(?:(?:or|and)\s*)?|or|and|或|和|[-–—]|to)\s*\d{1,2})*)\s*[- ]?(months?|weeks?|个月|月|周)(?![A-Za-z])/gi;
  for(const m of text.matchAll(pattern)){
   const before=text.slice(Math.max(0,m.index-100),m.index),after=text.slice(m.index+m[0].length,m.index+m[0].length+90),context=before+m[0]+after;
   if(field==='jd'||field==='durationEvidence'){
    if(/hear(?:d)? (?:back|from)|application.{0,35}(?:review|process)/i.test(before.slice(-80))||/^\s*(?:about|regarding) your application/i.test(after))continue;
    if(/graduat.{0,50}(?:within|next|in)\s*$/i.test(before)||/after.{0,25}(?:graduation|placement end)/i.test(after)||/(?:of\s+)?(?:previous\s+|relevant\s+|prior\s+)?experience\b|paid\s+(?:leave|vacation)|parental|maternity|paternity/i.test(after.slice(0,42))||/(?:first|initial|past|last)\s*$/i.test(before)||/parental|maternity|paternity|vacation|experience\s*(?:of|for|:)?\s*$/i.test(before.slice(-35)))continue;
    if(!/intern|co[ -]?op|work term|term\b|duration|placement|program.{0,20}(?:run|last)|contract|available|实习|时长/i.test(context))continue;
   }
   const numbers=m[1].match(/\d+/g).map(Number),unit=/week|周/i.test(m[2])?'weeks':'months';
   if(numbers.length>12||numbers.some(n=>n<1||n>52)){review.push(m[0]);continue;}
   const interval=/[-–—]|\bto\b/i.test(m[1]);
   if(interval){if(numbers.length!==2||numbers[0]>numbers[1]){review.push(m[0]);continue;}const value={min:numbers[0],max:numbers[1],unit,raw:m[0]};if(!ranges.some(r=>r.min===value.min&&r.max===value.max&&r.unit===unit))ranges.push(value);add(field,m[0],{kind:'range',...value});}
   else {for(const n of numbers){if(unit==='months'&&STANDARD.includes(n))options.add(n);else if(!other.some(v=>v.value===n&&v.unit===unit))other.push({value:n,unit,raw:m[0]});}add(field,m[0],{kind:'explicit',values:numbers,unit});}
  }
 }
 if(!options.size && !ranges.length && !other.length){
 // Structured values are explicit source observations; retain ranges without rounding.
 const valid=n=>Number.isInteger(n)&&n>=1&&n<=52;
 const structured=job.durationRange;
 if(structured && valid(structured.min) && valid(structured.max) && structured.min<=structured.max && (!structured.unit || structured.unit==='months')){
  if(structured.min===structured.max){if(STANDARD.includes(structured.min))options.add(structured.min);else other.push({value:structured.min,unit:'months',raw:String(structured.min)});}
  else ranges.push({min:structured.min,max:structured.max,unit:'months',raw:`${structured.min}-${structured.max} months`});
  add('durationRange',`${structured.min}-${structured.max} months`,{kind:'range',min:structured.min,max:structured.max,unit:'months'});
 }else if(valid(job.durationMonths)){
  if(STANDARD.includes(job.durationMonths))options.add(job.durationMonths);else other.push({value:job.durationMonths,unit:'months',raw:String(job.durationMonths)});
  add('durationMonths',`${job.durationMonths} months`,{kind:'explicit',values:[job.durationMonths],unit:'months'});
 }
 }
 // Only explicitly labelled full dates; never deadlines, graduation dates or rounded weeks.
 const jd=clean(job.jd),datePattern=/\b(?:internship\s+)?start date\s*:\s*(20\d{2}-\d{2}-\d{2})[\s\S]{0,100}?\b(?:internship\s+)?end date\s*:\s*(20\d{2}-\d{2}-\d{2})/gi;
 for(const m of jd.matchAll(datePattern)){if(/application|deadline|graduat/i.test(jd.slice(Math.max(0,m.index-45),m.index)))continue;const start=new Date(m[1]+'T00:00:00Z'),end=new Date(m[2]+'T00:00:00Z');if(!Number.isFinite(+start)||!Number.isFinite(+end)||end<=start||start.toISOString().slice(0,10)!==m[1]||end.toISOString().slice(0,10)!==m[2])continue;const inclusive=new Date(+end+86400000);const months=(end.getUTCFullYear()-start.getUTCFullYear())*12+end.getUTCMonth()-start.getUTCMonth()+(start.getUTCDate()===1&&inclusive.getUTCDate()===1?1:0);if((start.getUTCDate()===end.getUTCDate()||start.getUTCDate()===1&&inclusive.getUTCDate()===1)&&STANDARD.includes(months)){options.add(months);add('jd',m[0],{kind:'dates',values:[months],unit:'months'});}else{review.push(m[0]);add('jd',m[0],{kind:'date-interval',start:m[1],end:m[2]});}}
 // Cached employer prose uses spelled-out lengths and labelled calendar windows.
 const words={three:3,four:4,eight:8,twelve:12,sixteen:16};
 for(const m of jd.matchAll(/\b(three|four|eight|twelve|sixteen)[ -]+(months?|weeks?)\b/gi)){
  const before=jd.slice(Math.max(0,m.index-100),m.index),after=jd.slice(m.index+m[0].length,m.index+m[0].length+90);
  if(/hear(?:d)? (?:back|from)|application.{0,35}(?:review|process)/i.test(before.slice(-80))||/^\s*(?:about|regarding) your application/i.test(after))continue;
  if(/experience|parental|maternity|paternity|vacation|leave/i.test(after.slice(0,42))||/(?:first|initial|past|last)\s*$/i.test(before)||/parental|maternity|paternity|vacation|experience\s*(?:of|for|:)?\s*$/i.test(before.slice(-35)))continue;
  if(!/intern|co[ -]?op|work term|duration|placement|available|program/i.test(before+m[0]+after))continue;
  const n=words[m[1].toLowerCase()],unit=/week/i.test(m[2])?'weeks':'months';
  if(unit==='months'&&STANDARD.includes(n))options.add(n);else if(!other.some(v=>v.value===n&&v.unit===unit))other.push({value:n,unit,raw:m[0]});
  add('jd',m[0],{kind:'explicit',values:[n],unit});
 }
 const names='January|February|March|April|May|June|July|August|September|October|November|December',monthList=names.toLowerCase().split('|');
 const iso=(y,month,d)=>`${y}-${String(monthList.indexOf(month.toLowerCase())+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
 const calendar=(m,start,end,precision)=>{
  if(/application|deadline|graduat/i.test(jd.slice(Math.max(0,m.index-45),m.index)))return;
  if(start>end)return;
  if(precision==='day'&&[start,end].some(d=>{const v=new Date(d+'T00:00:00Z');return !Number.isFinite(+v)||v.toISOString().slice(0,10)!==d;}))return;
  const value={start,end,precision,raw:m[0]};intervals.push(value);add('jd',m[0],{kind:'calendar-interval',...value});
 };
 for(const m of jd.matchAll(new RegExp(`\\bInternship dates\\s*:\\s*(${names})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s+to\\s+(${names})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*,?\\s*(20\\d{2})`,'gi')))calendar(m,iso(m[5],m[1],m[2]),iso(m[5],m[3],m[4]),'day');
 for(const m of jd.matchAll(new RegExp(`\\b(?:Your )?internship will begin\\s+(\\d{1,2})\\s+(${names})\\s+(20\\d{2})\\s+and run until\\s+(\\d{1,2})\\s+(${names})\\s+(20\\d{2})`,'gi')))calendar(m,iso(m[3],m[2],m[1]),iso(m[6],m[5],m[4]),'day');
 for(const m of jd.matchAll(new RegExp(`\\bWork Term\\s*:\\s*(${names})\\s*[-–]\\s*(${names})\\s+(20\\d{2})`,'gi')))calendar(m,iso(m[3],m[1],1).slice(0,7),iso(m[3],m[2],1).slice(0,7),'month');
 for(const m of jd.matchAll(new RegExp(`\\bCo-op Duration\\s+This opportunity runs from\\s+(${names})\\s+(20\\d{2})\\s+through\\s+(${names})\\s+(20\\d{2})(?:, with some flexibility on start and end to accommodate academic schedules\\.)?`,'gi')))calendar(m,iso(m[2],m[1],1).slice(0,7),iso(m[4],m[3],1).slice(0,7),'month');
 for(const m of jd.matchAll(new RegExp(`\\b(?:Winter|Summer|Fall)\\s+(20\\d{2})\\s+Term\\s*\\((${names})\\s+(?:to|through)\\s+(${names})\\)`,'gi')))calendar(m,iso(m[1],m[2],1).slice(0,7),iso(m[1],m[3],1).slice(0,7),'month');
 for(const m of jd.matchAll(new RegExp(`\\b(?:Anticipated )?duration (?:will be )?from\\s+(${names})\\s+(?:through|to)\\s+(${names})\\s+(20\\d{2})(?:\\s*\\(flexible\\))?`,'gi')))calendar(m,iso(m[3],m[1],1).slice(0,7),iso(m[3],m[2],1).slice(0,7),'month');
 const values=[...options].sort((a,b)=>a-b);
 const status=values.length?'known':ranges.length?'range':other.length?'nonstandard':intervals.length?'dates':review.length?'needs_review':job.jd?'not_stated':'missing_jd';
 return {version:3,placements:internshipOptions(job),options:values,ranges,other,intervals,evidence,review,status,reason:({known:'明确月数',dates:'原文起止区间，未换算为月数档位',range:'原文为区间，非可选档位',nonstandard:'原文为非标准月数或周数',needs_review:'时长原文需核对',not_stated:'已获取JD，未识别明确时长',missing_jd:job.detailError?'JD获取失败':'JD尚未获取'})[status]};
}
