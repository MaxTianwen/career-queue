import { jobCategory } from '../../src/job-category.mjs';
import { jobCountries, remoteFacts, usRemoteEligibility } from '../../src/job-country.mjs';
import { durationFacts } from '../../src/duration-facts.mjs';
import { classifyResume } from '../../src/resume-track.mjs';
// Display and filtering only. Unknown facts stay unknown; never alter eligibility or records.
export function platform(url) {
 let u; try { u=new URL(url); } catch { return {name:'学校 / 手动入口',questions:false}; }
 const h=u.hostname.toLowerCase();
 const questions=u.protocol==='https:' && !u.port && !u.username && !u.password && ['boards.greenhouse.io','job-boards.greenhouse.io'].includes(h) && /^\/[\w-]+\/jobs\/\d+\/?$/.test(u.pathname);
 return {name:['boards.greenhouse.io','job-boards.greenhouse.io'].includes(h)?'Greenhouse':h==='jobs.ashbyhq.com'?'Ashby':h==='jobs.lever.co'?'Lever':h.endsWith('.myworkdayjobs.com')?'Workday':'公司官网',questions};
}
export function opportunityFacts(job) {
 const text=[job.term,job.duration,job.title,...String(job.jd||'').split(/[\n.!?]/).filter(s=>/\b(start|term|intern(?:ship)?s?|co.op|summer|winter|fall|duration)\b/i.test(s) && !/graduat|experience|degree/i.test(s))].filter(Boolean).join(' ');
 let seasons=[...new Set((text.match(/\b(winter|summer|fall)\b/gi)||[]).map(s=>s.toLowerCase()))];
 const durationInfo=durationFacts(job),durations=durationInfo.options.map(n=>({min:n,max:n})),durationIssues=[...durationInfo.review,...durationInfo.intervals.map(r=>r.raw),...durationInfo.ranges.map(r=>r.raw),...durationInfo.other.map(r=>r.raw)];
 if(durationInfo.placements.length)seasons=[...new Set(durationInfo.placements.map(p=>p.season))];
 const track=job.classification?.track || classifyResume(job).track;const category=jobCategory(job);
 return {seasons,durations,durationIssues,durationInfo,track,category,platform:job.hasSchool&&!job.hasPublic?(job.externalUrl?platform(job.externalUrl):{name:'学校 Portal',questions:false}):platform(job.url)};
}
export function normalizeCountry(value) {return value==='CA-US'?'all':['CA','US','all'].includes(value)?value:'CA';}
export function matchesOpportunity(job,filters={}) {
 const query=String(filters.query||'').trim().toLocaleLowerCase();
 if(query&&!query.split(/\s+/).every(word=>[job.company,job.title,job.requisitionId,job.schoolId,...(job.schoolSources||[]).map(s=>s.schoolId)].join(' ').toLocaleLowerCase().includes(word)))return false;
 const f=opportunityFacts(job),unknown=filters.unknown===true;
 const countries=jobCountries(job),country=filters.country?normalizeCountry(filters.country):'all';if(country!=='all'&&!(country==='US'?usRemoteEligibility(job).eligible:countries.includes(country)))return false;
 if(filters.source==='school'&&!job.hasSchool)return false;
 if(filters.source==='public'&&!job.hasPublic)return false;
 const matches=(known,match)=>known?match:unknown;
 if(filters.season && !matches(f.seasons.length,f.seasons.includes(filters.season)))return false;
 if(filters.months){
  const n=+filters.months,placements=f.durationInfo.placements;
  if(placements.length){if(!placements.some(p=>(!filters.season||p.season===filters.season)&&n>=p.months.min&&n<=p.months.max))return false;}
  else {const lengths=[...f.durations,...f.durationInfo.ranges.filter(r=>r.unit==='months'),...f.durationInfo.other.filter(r=>r.unit==='months').map(r=>({min:r.value,max:r.value}))];if(!matches(lengths.length,lengths.some(d=>n>=d.min&&n<=d.max)))return false;}
 }
 if(filters.category && !matches(f.category.primary!=='unknown',f.category.primary===filters.category||(f.category.primary==='mixed'&&['cs','data'].includes(filters.category))))return false;
 if(filters.location && !matches(Boolean(job.location&&!/^(unknown|未提供)$/i.test(job.location)),(job.location||'').toLowerCase().includes(filters.location.toLowerCase())))return false;
 if(filters.platform && f.platform.name!==filters.platform)return false;
 return true;
}
export function factsLabel(job) {
 const f=opportunityFacts(job);
 if(f.durationInfo.placements.length){const labels=f.seasons.map(season=>{const values=[...new Set(f.durationInfo.placements.filter(p=>p.season===season).map(p=>p.months.kind==='range'?p.months.min+'–'+p.months.max+'（范围）':String(p.months.min)))];return season[0].toUpperCase()+season.slice(1)+' '+values.join(' / ')+' 个月';});return labels.join(' · ')+' · '+f.platform.name;}
 return `${f.seasons.join(' / ')||'开始学期未知'} · ${f.durations.map(d=>d.min===d.max?d.min:d.min+'–'+d.max).join(' / ')||f.durationInfo.ranges.map(v=>v.min+'–'+v.max+(v.unit==='weeks'?' 周':' 个月')).join(' / ')||f.durationInfo.other.map(v=>v.value+(v.unit==='weeks'?' 周':' 个月')).join(' / ')||f.durationInfo.intervals.map(v=>v.start+' 至 '+v.end).join(' / ')||'时长未知'}${f.durations.length?' 个月':''} · ${f.platform.name} · ${f.platform.questions?'可读取申请问题':'准备材料后去官网申请'}`;
}
export function mountFilters(container,onChange,{schoolOnly=false,country='CA'}={}) {
 container.className='opportunity-filters';
 const search=document.createElement('label');search.className='filter-search';search.textContent='搜索职位';const query=document.createElement('input');query.type='search';query.name='query';query.placeholder='职位、公司或编号';search.append(query);container.append(search);
 const extra=document.createElement('details');extra.className='filter-extra';const title=document.createElement('summary');title.textContent='更多条件';extra.append(title);
 for(const [name,label,choices] of [['category','职位类别',[['','所有类别'],['cs','CS / Software'],['embedded','Firmware / Embedded'],['data','数据 / 分析']]],['season','开始学期',[['','所有学期'],['winter','Winter'],['summer','Summer'],['fall','Fall']]],['months','时长（月）',[['','所有时长'],...[3,4,8,12,16].map(n=>[String(n),n+' 个月'])]],['country','工作地点国家',[['CA','加拿大'],['US','美国'],['all','全部']]],['source','职位来源',[['','全部来源'],['school','学校职位'],['public','网络发现']]],['platform','申请方式',[['','所有平台'],['Greenhouse','Greenhouse'],['Ashby','Ashby'],['Lever','Lever'],['Workday','Workday'],['公司官网','公司官网'],['学校 Portal','学校 Portal']]]]) {
  if(schoolOnly&&name==='source')continue;
  const l=document.createElement('label');l.textContent=label;const select=document.createElement('select');select.name=name;for(const [v,t] of choices)select.add(new Option(t,v));if(name==='country')select.value=normalizeCountry(country);l.append(select);(['source','platform'].includes(name)?extra:container).append(l);
 }
 const l=document.createElement('label');l.textContent='城市 / 地点';const input=document.createElement('input');input.name='location';input.placeholder='城市 / remote';l.append(input);extra.append(l);
 const u=document.createElement('label');u.className='check';const c=document.createElement('input');c.type='checkbox';c.name='unknown';u.append(c,'同时保留相关条件未知的职位');extra.append(u);container.append(extra);
 const reset=document.createElement('button');reset.type='button';reset.className='filter-reset quiet';reset.textContent='清空筛选';reset.addEventListener('click',()=>{for(const e of container.querySelectorAll('input,select')){if(e.type==='checkbox')e.checked=false;else e.value=e.name==='country'?'CA':'';}onChange();});container.append(reset);
 container.addEventListener('input',event=>{if(event.target.tagName!=='SELECT')onChange();});container.addEventListener('change',onChange);
 return ()=>Object.fromEntries([...container.querySelectorAll('input,select')].map(e=>{if(e.name==='country')e.value=normalizeCountry(e.value);return [e.name,e.type==='checkbox'?e.checked:e.value];}));
}

// Fixed semantic tokens shared by discovery, school, cards and tables.
export const factPalette = Object.freeze({"season-summer": {"label": "Summer", "foreground": "#854500", "background": "#fff2cf"}, "season-fall": {"label": "Fall", "foreground": "#93351b", "background": "#ffeadf"}, "season-winter": {"label": "Winter", "foreground": "#18558c", "background": "#e5f2ff"}, "months-4": {"label": "4 个月", "foreground": "#006355", "background": "#dcf6ef"}, "months-8": {"label": "8 个月", "foreground": "#35499c", "background": "#eaf0ff"}, "months-12": {"label": "12 个月", "foreground": "#952e59", "background": "#ffe7f0"}, "months-16": {"label": "16 个月", "foreground": "#683899", "background": "#f1e7ff"}, "unknown": {"label": "待确认", "foreground": "#525967", "background": "#eef0f3"}});
export function factBadges(job) {
 const facts=opportunityFacts(job),box=document.createElement('div');box.className='fact-badges';
 if(job.hasSchool){const badge=document.createElement('span');badge.className='badge school-source';badge.textContent=job.hasPublic?'学校 + 网络':'学校职位';box.append(badge);}
 const token=(key,label)=>{const badge=document.createElement('span');badge.className='badge fact-token fact-'+key;badge.textContent=label || factPalette[key].label;box.append(badge);};
 if(facts.seasons.length)for(const season of facts.seasons)token('season-'+season);else token('unknown','学期未知');
 if(!facts.durationInfo.placements.length&&facts.durations.length)for(const duration of facts.durations)token('months-'+duration.min);
 for(const range of (facts.durationInfo.placements.length?[]:facts.durationInfo.ranges))token('unknown',`${range.min}–${range.max} ${range.unit==='weeks'?'周':'个月'}`);
 for(const item of (facts.durationInfo.placements.length?[]:facts.durationInfo.other))token('unknown',`${item.value} ${item.unit==='weeks'?'周':'个月'}`);
 for(const item of facts.durationInfo.intervals)token('unknown',`${item.start} 至 ${item.end}`);
 if(!facts.durations.length&&!facts.durationInfo.ranges.length&&!facts.durationInfo.other.length&&!facts.durationInfo.intervals.length)token('unknown','时长未知');
 if(facts.durationInfo.placements.length){const choices=document.createElement('div');choices.className='placement-options';for(const p of facts.durationInfo.placements){const line=document.createElement('p');line.textContent=`${p.season[0].toUpperCase()+p.season.slice(1)} · ${p.months.kind==='range'?p.months.min+'–'+p.months.max+' 个月':p.months.min+' 个月'} · ${p.start}${p.end?' 至 '+p.end:' 起'}`;choices.append(line);}box.append(choices);}
 if(job.eligibilityReview)token('unknown','资格待核实');
 const countries=jobCountries(job),remote=remoteFacts(job);const country=document.createElement('span');country.className='badge country-badge';country.textContent=countries.map(c=>c==='CA'?'加拿大':'美国').join(' / ')||'工作地点国家待核实';box.append(country);
 if(countries.includes('US')){const warning=document.createElement('div');warning.className='country-restrictions';warning.textContent=(/2027/.test(job.title||'')&&/\b(?:Summer|Winter|Fall) 2026\b/i.test(job.jd||'')?'标题与正文年份不一致，学期需核实。 ':'')+(remote.fullyRemote?'全远程 · ':'')+'美国岗位：不代表可从加拿大工作。'+(remote.restrictions.length?' '+remote.restrictions.join(' '):' 居住及工作授权要求待核实。');box.append(warning);}
 const category=document.createElement('span');category.className='badge category-badge';category.textContent=facts.category.label;box.append(category);
 const platform=document.createElement('span');platform.className='badge';platform.textContent=facts.platform.name;box.append(platform);
 return box;
}

export function deadlineSummary(job) {
 const lines=[];
 if(job.hasPublic && job.deadline)lines.push('官网截止：'+job.deadline);
 const schools=(job.schoolSources||[]).map(source=>({id:source.schoolId,value:source.row?.deadlineText||source.row?.deadline})).filter(source=>source.value);
 for(const source of schools)lines.push('学校截止'+(schools.length>1?'（'+source.id+'）':'')+'：'+source.value);
 const p=document.createElement('p');p.className='card-deadline';p.textContent=lines.join(' · ')||'截止日期未提供';return p;
}
