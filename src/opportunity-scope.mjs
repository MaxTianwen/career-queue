import { usRemoteEligibility, jobCountries, countryFilterFacts } from './job-country.mjs';
export function opportunityScope(job={},preferences={}){
 if(preferences.opportunityScope==='canada-us-remote'){if(countryFilterFacts(job).usEmployerRemote)return {excluded:false,review:true,code:'us-employer-fully-remote'};const facts=usRemoteEligibility(job);if(facts.countries.includes('US')&&(!facts.countries.includes('CA')||facts.eligible)){if(facts.eligible)return {excluded:false,review:true,code:'us-fully-remote',restrictions:facts.restrictions};return {excluded:true,review:false,restricted:true,kind:'geography',code:'us-remote-cs-unconfirmed',reason:'美国岗位须为明确全远程的 CS 相关岗位',quote:!facts.csRelated?'非 CS 相关岗位':facts.conflict?'存在混合/现场办公要求':'未确认 fully remote',sourceUrl:job.sourceEvidence?.url||job.externalUrl||job.url||''};}return opportunityScope(job,{...preferences,opportunityScope:'canada-or-remote'});}
 if(preferences.opportunityScope!=='canada-or-remote')return {excluded:false,review:false};
 const location=String(job.location||''),body=String(job.jd||job.eligibilityText||'');
 const negative=body.match(/(?:must|required to|need to|shall)\s+(?:be\s+)?(?:located|reside|live|based)\s+(?:in|within)\s+(?:the\s+)?(?:United States|U\.?S\.?A?\b|United Kingdom|UK\b|Germany|France|Australia|India|Singapore|Japan|China|Mexico|Brazil|Ireland|Netherlands|Spain|Italy|Switzerland|outside Canada)[^.!?\n]{0,90}|(?:US|USA|United States|UK|United Kingdom)[ -]only|(?:not (?:available|open|eligible)|unavailable)\s+(?:to|in|for)\s+(?:applicants?\s+(?:in|from)\s+)?Canada/gi);
 const reason=(code,quote)=>({excluded:true,review:false,restricted:true,kind:'geography',reason:'不符合加拿大现场/混合或远程地区条件',code,quote,sourceUrl:job.sourceEvidence?.url||job.externalUrl||job.url||'',capturedAt:job.sourceEvidence?.retrievedAt||job.sourceUpdatedAt||null});
 if(negative?.length)return reason('explicit-residency',negative[0]);
 const inCanada=jobCountries(job).includes('CA')&&!countryFilterFacts(job).usEmployerRemote;
 if(inCanada)return {excluded:false,review:false};
 const bodyRegion=body.match(/\blocation\s*:\s*remote\s*\((U\.?S\.?A?|United States|United Kingdom|UK)\)/i);
 if(bodyRegion)return reason('remote-region-restriction',bodyRegion[0]);
 const hybrid=/hybrid/i.test(job.workMode||'')||/hybrid/i.test(location)||/this (?:role|position).{0,90}hybrid/i.test(body),onsite=/^(?:onsite|on-site)$/i.test(job.workMode||'');
 const remote=!hybrid&&!onsite&&(/remote/i.test(job.workMode||'')||/\bremote\b/i.test(location));
 if(remote){const region=location.match(/\bremote\s+(?:in|within|only in)\s+([^/;]+)/i)?.[1];if(region&&!/canada|north america|americas|worldwide|global|anywhere/i.test(region))return reason('remote-region-restriction',location);if(/\b(?:USA?|United States(?: of America)?|UK|United Kingdom)\b/i.test(location)&&!/worldwide|global|anywhere/i.test(location))return reason('remote-region-restriction',location);if(/\b(?:in|within|only|based in)\s+(?:the\s+)?(?:USA?|United States|UK|United Kingdom)\b|\b(?:USA?|United States|UK|United Kingdom)\s*[-–(,/]?\s*remote\b/i.test(location))return reason('remote-region-restriction',location);return {excluded:false,review:true,code:'remote-eligibility-unconfirmed'};}
 return reason('outside-canada-or-location-unconfirmed',location||'加拿大办公地点未确认');
}
