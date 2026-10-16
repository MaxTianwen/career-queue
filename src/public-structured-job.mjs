import { validPublicationInstant } from './publication-facts.mjs';
import { fetchGreenhouse } from './greenhouse.mjs';
import {postingText} from './discovery-sources.mjs';
const hosts=new Set(['careers.arcresources.com','careers.rbi.com','careers.amd.com','www.google.com','stripe.com','grassvalley.applytojob.com','jobs.smartrecruiters.com','campus-globalcareers-atlassian.icims.com','careers-kinaxis.icims.com','hdks.fa.ca2.oraclecloud.com','app.careerpuck.com','fa-evmr-saasfaprod1.fa.ocs.oraclecloud.com','www.tesla.com','www.tower-research.com','tower-research.com','ats.rippling.com','careers.trccompanies.com','rodanenergysolutionsinc.applytojob.com','www.pinterestcareers.com','apply.workable.com','jobs.ea.com']);
const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
export function publicJobIdentity(value){try{const u=new URL(value);return u.searchParams.get('gh_jid')||u.pathname.match(/^\/global\/en\/job\/(R\d+)(?:\/|$)/)?.[1]||u.pathname.match(/\/careers\/listing\/[^/]+\/(\d+)/)?.[1]||u.pathname.match(/\/j\/([A-Z0-9]+)(?:\/|$)/)?.[1]||u.pathname.match(/\/(?:jobs?|results|JobDetail)\/(\d+)(?:[-/]|$)/i)?.[1]||u.pathname.match(/\/apply\/([A-Za-z0-9]+)\//)?.[1]||u.pathname.match(/\/jobs\/([a-f0-9-]{36})/i)?.[1]||u.pathname.match(/\/job\/[^/]+\/(\d+)\/?$/)?.[1]||'';}catch{return '';}}
const attr=(s,k)=>s.match(new RegExp(`\\b${k}\\s*=\\s*["']([^"']+)["']`,'i'))?.[1]||'';
function sameIdentity(a,b){try{const x=new URL(a),y=new URL(b),ia=publicJobIdentity(a),ib=publicJobIdentity(b);return (ia&&ib?ia===ib:x.origin===y.origin&&x.pathname.replace(/\/$/,'')===y.pathname.replace(/\/$/,''));}catch{return false;}}
function element(html,pattern){const match=pattern.exec(html);if(!match)return '';const tag=match[1];let depth=1;const re=new RegExp(`<\\/?${tag}\\b[^>]*>`,'gi');re.lastIndex=match.index+match[0].length;let token;while((token=re.exec(html))){depth+=token[0].startsWith('</')?-1:1;if(!depth)return html.slice(match.index,re.lastIndex);}return '';}
export function parseStructuredJob(html,candidate){
 const nodes=[];const visit=x=>{if(Array.isArray(x))x.forEach(visit);else if(x&&typeof x==='object'){if([].concat(x['@type']||[]).includes('JobPosting'))nodes.push(x);if(x['@graph'])visit(x['@graph']);}};
 for(const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{visit(JSON.parse(m[1]));}catch{}}
 const canonical=[...html.matchAll(/<link\b[^>]*>/gi)].find(m=>attr(m[0],'rel')==='canonical');const canonicalUrl=canonical&&attr(canonical[0],'href');
 if(canonicalUrl&&!sameIdentity(candidate.url,canonicalUrl))throw new Error('官方页面跳到不同岗位，编号不匹配');
 const requestedId=String(candidate.requisitionId||publicJobIdentity(candidate.url));
 const matches=nodes.filter(j=>{const id=String(j.identifier?.value || (typeof j.identifier==='string'?j.identifier:'') || '');if(id&&requestedId&&id!==requestedId)return false;return j.description&&(j.url?sameIdentity(candidate.url,j.url):requestedId?id===requestedId:norm(j.title)===norm(candidate.title));});
 let j=matches.length===1?matches[0]:null,field='JobPosting.description';
 if(!j&&!nodes.length&&canonicalUrl){
  const host=new URL(candidate.url).hostname;let content='';const title=postingText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'').replace(/\s*(?:— Google Careers|\|.*)$/,'');
  if(host==='careers.arcresources.com')content=element(html,/<(span|div)\b[^>]*class=["'][^"']*jobdescription[^"']*["'][^>]*>/i);
  else if(host==='jobs.ea.com')content=element(html,/<(div|article|main)\b[^>]*class=["'][^"']*main__content[^"']*["'][^>]*>/i);
  else if(host.endsWith('.applytojob.com'))content=element(html,/<(div|section)\b[^>]*(?:id|class)=["'][^"']*job-description[^"']*["'][^>]*>/i);
  else if(host==='ats.rippling.com')content=html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1]||'';
  else if(host==='www.google.com'){
   const text=postingText(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,''));const start=text.indexOf('Minimum qualifications:');const body=element(html,/<(div)\b[^>]*class=["']KwJkGe["'][^>]*>/i);if(body)content=body;else if(start>=0)content=text.slice(start).split(/Information collected and processed|Google is proud to be an equal opportunity/)[0];
  }
  content=content.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'');
  if(content&&title){j={title:host==='careers.arcresources.com'?postingText(element(html,/<(span)\b[^>]*itemprop=["']title["'][^>]*>/i))||title:title,description:content};field='official-page.job-description';}
 }
 if(!j)throw new Error('公开页面未返回可唯一核对的岗位正文');const jd=postingText(j.description);if(jd.length<120||jd.length>60000)throw new Error('公开JD长度异常');
 const addresses=[].concat(j.jobLocation || []).map(x=>x?.address).filter(Boolean);
 const googleLocation=new URL(candidate.url).hostname==='www.google.com'?postingText(html.match(/preferred working location[^<]{0,100}<b>([^<]+)<\/b>/i)?.[1] || html.match(/>place<\/i><span class=["']r0wTof[^"']*["']>([^<]+)<\/span>/i)?.[1] || ''):'';
 const microLocation=new URL(candidate.url).hostname==='careers.arcresources.com'?['addressLocality','addressRegion','addressCountry'].map(k=>html.match(new RegExp('itemprop=["\']'+k+'["\'] content=["\']([^"\']+)["\']','i'))?.[1]).filter(Boolean).join(', '):'';
 const officialLocation=googleLocation || microLocation || addresses.map(a=>[a.addressLocality,a.addressRegion,typeof a.addressCountry==='string'?a.addressCountry:a.addressCountry?.name].filter(Boolean).join(', ')).join(' / ');
 const rawPostedAt=typeof j.datePosted==='string'?j.datePosted:'';
 const normalized=rawPostedAt.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
 const publication=rawPostedAt?{postedAt:validPublicationInstant(normalized)?normalized:rawPostedAt,postedAtKind:'official'}:{};
 const publicationEvidence=rawPostedAt?{postedAtField:'JobPosting.datePosted',postedAtRaw:rawPostedAt,publicationUrl:candidate.url}:{};
 return {...candidate,...publication,title:j.title||candidate.title,jd,...(officialLocation?{location:officialLocation,locationEvidence:{source:'official-detail',text:officialLocation}}:{}),detailError:null,sourceEvidence:{url:candidate.url,retrievedAt:new Date().toISOString(),field,...publicationEvidence},requisitionId:String(j.identifier?.value||requestedId||''),duration:typeof j.jobDuration==='string'?j.jobDuration:candidate.duration||''};
}
export async function publicStructuredJob(candidate,fetchImpl=fetch){
 const url=new URL(candidate.url);if(url.protocol!=='https:'||url.port||url.username||url.password||!hosts.has(url.hostname))return null;
 const get=async address=>{const r=await fetchImpl(address,{redirect:'manual',signal:AbortSignal.timeout(12000),headers:{Accept:'text/html,application/json','User-Agent':'CareerQueue/2.10'}});return r;};
 if(url.hostname==='jobs.smartrecruiters.com'){
  const m=url.pathname.match(/^\/([A-Za-z0-9_-]+)\/(\d+)(?:-[^/]*)?\/?$/);if(!m)return null;const api='https://api.smartrecruiters.com/v1/companies/'+m[1]+'/postings/'+m[2];const r=await get(api);if(!r.ok)throw new Error('公开JD HTTP '+r.status);const j=await r.json();if(String(j.id)!==m[2]||j.company?.identifier!==m[1])throw new Error('SmartRecruiters公司或岗位编号不匹配');const jd=postingText(Object.values(j.jobAd?.sections||{}).map(v=>[v.title,v.text].filter(Boolean).join('\n')).join('\n'));if(jd.length<120||jd.length>60000)throw new Error('SmartRecruiters正文不完整');return {...candidate,title:j.name,jd,requisitionId:j.refNumber||m[2],detailError:null,sourceEvidence:{url:api,retrievedAt:new Date().toISOString(),field:'jobAd.sections'}};
 }
 if(url.hostname==='apply.workable.com'){
  const m=url.pathname.match(/^\/([a-z0-9_-]+)\/j\/([A-Z0-9]+)(?:\/apply)?\/?$/);if(!m)return null;const api=url.origin+'/api/v2/accounts/'+m[1]+'/jobs/'+m[2];const r=await get(api);if(!r.ok)throw new Error('公开JD HTTP '+r.status);const j=await r.json();if(j.shortcode!==m[2])throw new Error('Workable岗位编号不匹配');const jd=postingText([j.description,j.requirements,j.benefits].filter(Boolean).join('\n'));if(jd.length<120||jd.length>60000)throw new Error('Workable正文不完整');return {...candidate,title:j.title,jd,detailError:null,sourceEvidence:{url:api,retrievedAt:new Date().toISOString(),field:'description/requirements/benefits'}};
 }
 if(url.hostname.endsWith('.oraclecloud.com')){
  const id=url.pathname.match(/\/job\/(\d+)$/)?.[1];if(!id)return null;
  const api=url.origin+'/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?onlyData=true&expand=all&finder=ById;Id='+id;
  const r=await get(api);if(!r.ok)throw new Error('公开JD HTTP '+r.status);const data=await r.json();const items=data.items?.filter(j=>String(j.Id)===id)||[];if(items.length!==1)throw new Error('Oracle招聘编号不匹配');const j=items[0];
  const jd=postingText([j.ShortDescriptionStr,j.ExternalDescriptionStr,j.ExternalResponsibilitiesStr,j.ExternalQualificationsStr,j.CorporateDescriptionStr,j.OrganizationDescriptionStr].filter(Boolean).join('\n'));if(jd.length<120||jd.length>60000)throw new Error('Oracle正文不完整');
  return {...candidate,title:j.Title,jd,requisitionId:id,detailError:null,sourceEvidence:{url:api,retrievedAt:new Date().toISOString(),field:'recruitingCEJobRequisitionDetails.ExternalDescriptionStr'}};
 }
 let address=url.href;if(url.hostname==='apply.workable.com')address=address.replace(/\/apply$/,'');let response=await get(address);
 // A normal URL migration is allowed only for the same host (or the fixed www alias), retaining the requested posting ID.
 for(let count=0;count<3&&[301,302,307,308].includes(response.status);count++){
  const next=new URL(response.headers.get('location'),address);if(next.protocol!=='https:'||next.port||next.username||next.password||!(next.hostname===url.hostname||url.hostname==='www.tower-research.com'&&next.hostname==='tower-research.com')||!sameIdentity(candidate.url,next.href))throw new Error('公开页面跳转无法核实为原岗位');address=next.href;response=await get(address);
 }
 if(!response.ok)throw new Error('公开JD HTTP '+response.status);
 if(Number(response.headers.get('content-length'))>2000000)throw new Error('公开JD超过大小限制');let html=await response.text();if(html.length>2000000)throw new Error('公开JD超过大小限制');
 if(url.hostname==='campus-globalcareers-atlassian.icims.com'){
  const src=html.match(/<iframe\b[^>]*src="([^"]+in_iframe=1)"/i)?.[1];if(src){const next=new URL(src);if(next.origin!==url.origin||next.pathname!==url.pathname)throw new Error('嵌入正文编号不匹配');const r=await get(src);if(!r.ok)throw new Error('嵌入正文 HTTP '+r.status);html=await r.text();if(html.length>2000000)throw new Error('公开JD超过大小限制');}
 }
 if(['www.tower-research.com','tower-research.com'].includes(url.hostname)&&html.includes('https://boards.greenhouse.io/embed/job_board/js?for=towerresearchcapital')){
  const id=url.searchParams.get('gh_jid');if(!/^\d+$/.test(id||''))throw new Error('Greenhouse岗位编号缺失');const detail=await fetchGreenhouse('https://job-boards.greenhouse.io/towerresearchcapital/jobs/'+id,candidate.company,fetchImpl);return {...candidate,...detail,url:candidate.url};
 }
 return parseStructuredJob(html,candidate);
}
