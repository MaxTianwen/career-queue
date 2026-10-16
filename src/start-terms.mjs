import {seasonForMonth} from './internship-options.mjs';
import {durationFacts,verifiedSchoolDisplay} from './duration-facts.mjs';
const unique=pairs=>[...new Map(pairs.map(p=>[p.season+':'+p.year,p])).values()];
const excluded=/graduat|class of|degree|ending|ends? in|deadline|closing|posted|published|application (?:date|closes)|end date/i;
function namedTerms(value){
 const text=String(value||'').replace(/\b(20\d{2})\s+(winter|summer|fall)\b/gi,'$2 $1'),pairs=[];
 for(const part of text.split(/[\n.!?]/)){if(excluded.test(part))continue;for(const m of part.matchAll(/\b((?:winter|summer|fall)(?:\s*(?:\/|,|and|or|&)\s*(?:winter|summer|fall))*)\s*(20\d{2})?\b/gi))for(const season of m[1].toLowerCase().match(/winter|summer|fall/g))pairs.push({season,year:m[2]||null});}
 return unique(pairs);
}
export function startTerms(job={}){
 const info=durationFacts(job),school=verifiedSchoolDisplay(job);
 if(info.placements.length)return unique(info.placements.map(p=>({season:p.season,year:/^20\d{2}/.exec(p.start||'')?.[0]||null})));
 // These structured intervals/windows identify start and end separately; never use end years.
 const starts=[...info.intervals.map(p=>p.start),...info.windows.flatMap(p=>p.startOptions)];
 if(starts.length)return unique(starts.map(p=>({season:seasonForMonth(Number(String(p).slice(5,7))),year:/^20\d{2}/.exec(p)?.[0]||null})));
 for(const text of [school?.term||job.term,job.title]){if(!text)continue;const named=namedTerms(text);if(named.length){const years=[...new Set(String(text).match(/\b20\d{2}\b/g)||[])];if(named.length===1&&!named[0].year&&years.length===1&&!excluded.test(text))return [{...named[0],year:years[0]}];return named;}if(!excluded.test(text)){const years=[...new Set(String(text).match(/\b20\d{2}\b/g)||[])];if(years.length===1)return [{season:null,year:years[0]}];}}
 const pairs=[];for(const sentence of String(job.jd||'').split(/[\n.!?]/)){
  if(excluded.test(sentence.replace(/\bend date[\s\S]*/i,'')))continue;
  const start=sentence.match(/\b(?:internship\s+)?start(?: date|s|ing)?\s*(?::|in|on)?\s*(?:[A-Za-z]+\s+\d{1,2},?\s+|[A-Za-z]+\s+)?(20\d{2})(?:-\d{2}-\d{2})?/i);
  if(start){pairs.push({season:null,year:start[1]});continue;}
  if(/\b(?:internship|work term|co-op|starts?|starting)\b/i.test(sentence))pairs.push(...namedTerms(sentence.split(/\b(?:ends?|ending|until|through)\b/i)[0]));
 }
 return unique(pairs);
}
export function inOpportunityYear(job,year='2027'){const terms=startTerms(job);return !terms.length||terms.some(p=>!p.year||p.year===String(year));}
