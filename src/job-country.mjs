import {jobCategory} from './job-category.mjs';
import { classifyResume } from './resume-track.mjs';
const ca=/\b(?:canada|canadian|toronto|markham|vaughan|waterloo|ottawa|montr[eé]al|qu[eé]bec|vancouver|burnaby|richmond hill|scarborough|north york|newmarket|calgary|edmonton|halifax|winnipeg|saskatoon|mississauga|ontario|british columbia|alberta|manitoba|saskatchewan|newfoundland|st\.? john'?s|vernon|victoria|kitchener|guelph|burlington|oakville|fredericton)\b/i;
const us=/\b(?:United States(?: of America)?|U\.?S\.?A?\.?|California|Minnesota|Maine|Texas|New York|San Francisco|Seattle|Boston|Austin)\b/i;
export function jobCountries(job={}) {
 const location=String(job.location||''),countries=[];
 if(ca.test(location)||/\b(?:ON|BC|QC|AB|MB|SK|NS|NB|NL|PE)\b/.test(location))countries.push('CA');
 if(us.test(location)||/\b(?:must|required to)\s+(?:be\s+)?(?:located|reside|live|based)\s+(?:in|within)\s+(?:the\s+)?(?:United States|USA?|U\.S\.)\b/i.test(job.jd||'')||/\blocation\s*:\s*remote\s*\(U\.?S\.?\)/i.test(job.jd||''))countries.push('US');
 return countries;
}
export function remoteFacts(job={}) {
 const body=String(job.jd||''),location=String(job.location||''),mode=String(job.workMode||'');
 const restrictions=body.split(/\n|(?<=[.!?])\s+/).filter(s=>/\b(?:resid\w*|located|based in|work authori[sz]\w*|authori[sz]ed to work|sponsor\w*|visa\w*|U\.?S\.?[- ]only)\b/i.test(s)).map(s=>s.trim()).filter(Boolean);
 // An employer-wide menu of work modes is not a requirement for this job.
 const roleBody=body.replace(/We offer remote, hybrid, and onsite options for flexibility[^.!?]*(?:[.!?]|$)/gi,'');
 let officialRemoteOffice=false;
 try { const source=new URL(job.sourceEvidence?.url);const target=new URL(job.url);officialRemoteOffice=source.protocol==='https:'&&/\.myworkdayjobs\.com$/.test(source.hostname)&&source.origin+source.pathname===target.origin+target.pathname&&Boolean(job.sourceEvidence?.retrievedAt)&&/^[A-Za-z .]+ - Remote Office, United States(?: of America)?$/i.test(location); } catch {}
 const conflict=/hybrid|on[- ]?site/i.test(mode+' '+location)||/\b(?:not|isn.t|cannot be)\s+(?:a\s+)?(?:fully\s+|100%\s+)?remote\b|\b(?:hybrid|onsite|on-site)\s+(?:options?|schedule|role|position|work)\b|\b(?:remote,?\s+hybrid|hybrid,?\s+and\s+onsite)\b|\b(?:required|expected|must)\s+(?:to\s+)?(?:work|be|attend).{0,35}(?:in[- ]office|on[- ]site)\b/i.test(roleBody);
 const field=job.fieldEvidence?.workMode;
 const structured=field?.status==='extracted'&&field.source==='workplaceType'&&/^remote$/i.test(field.raw||'');
 const explicit=body.match(/\b(?:fully|entirely|100\s*%)\s*[- ]?remote\b|\bremote[- ]only\b|\b(?:no|without any)\s+(?:required\s+)?(?:in[- ]office|on[- ]site)\s+(?:work|attendance|requirement)/i);
 const optionalOffice=/this is a remote position.{0,300}if (?:the intern|you|they|the candidate) would prefer to work in an office/is.test(body);
 const uncertain=/\b(?:may|might|could|possibly|potentially)\s+(?:be\s+)?(?:fully|entirely|100\s*%)\s*remote/i.test(body);
 const negated=/\b(?:not|never)\s+(?:a\s+)?(?:fully|entirely|100\s*%)\s*remote/i.test(body);
 return {fullyRemote:!conflict&&!uncertain&&!negated&&Boolean(structured||officialRemoteOffice||explicit||optionalOffice),evidence:structured?'Official workplaceType: Remote':officialRemoteOffice?'Official Workday job location: '+location:explicit?.[0]||(optionalOffice?'Remote position; office attendance explicitly optional':''),conflict:conflict||uncertain||negated,restrictions};
}
// Discovery eligibility is broader than the suggested resume template category.
export function csRelatedFacts(job={}) {
 const classification=classifyResume(job);
 const title=String(job.title||'');
 const engineering=title.match(/\b(?:(?:AI|ML|machine learning|artificial intelligence|data|analytics|platform|security|cloud|infrastructure)\s+engineer(?:ing)?|MLOps)\b/i);
 const jd=job.fullJd===false?'':String(job.jd||'');
 const actions=jd.split(/\n|(?<=[.!?])\s+/).filter(s=>/^\s*(?:[-•]\s*)?(?:build|create|develop|deploy|deliver|implement|maintain|design|conduct)\b/i.test(s)&&!/\b(?:degree|bachelor|master|collaborat\w* with|work(?:ing)? with)\b/i.test(s)).join('\n').match(/\b(?:build|create|develop|deploy|deliver|implement|maintain|design)(?:ing|s)?\s+(?:[\w,-]+\s+){0,5}(?:(?:AI|ML|generative|software)\s+(?:applications?|features|systems)|(?:production[- ]grade|backend)\s+(?:solutions?|services?)|(?:ETL|data)\s+pipelines?)\b|\bconduct\s+(?:[\w-]+\s+){0,3}machine learning research\b/i);
 return {csRelated:jobCategory(job).primary==='embedded'||['cs','mixed'].includes(classification.track)||Boolean(engineering||actions),csEvidence:[...(engineering?[engineering[0]]:[]),...(actions?[actions[0]]:[])],track:classification.track};
}
export function usRemoteEligibility(job={}) {
 const countries=jobCountries(job),remote=remoteFacts(job),related=csRelatedFacts(job);
 return {...remote,countries,...related,eligible:countries.includes('US')&&related.csRelated&&remote.fullyRemote};
}
