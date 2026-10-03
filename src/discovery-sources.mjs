import { readAmazonBoard } from './amazon.mjs';
import { readQualcommBoard } from './qualcomm.mjs';
import { readGenesysBoard } from './genesys-board.mjs';
import { readCelesticaBoard } from './celestica.mjs';

// Fixed public employer boards, not a global ATS search or an arbitrary URL reader.
export const EMPLOYER_SOURCES = [
  { id: 'qualcomm', name: 'Qualcomm', type: 'qualcomm', board: 'canada-internships', url: 'https://careers.qualcomm.com/careers?query=intern&location=Canada' },
  { id: 'amazon', name: 'Amazon', type: 'amazon', board: 'canada-internships', url: 'https://www.amazon.jobs/en/search?base_query=intern&country=CAN' },
  { id: 'tenstorrent', name: 'Tenstorrent', type: 'greenhouse', board: 'tenstorrentuniversity', url: 'https://job-boards.greenhouse.io/tenstorrentuniversity' },
  { id: 'cohere', name: 'Cohere', type: 'ashby', board: 'cohere', url: 'https://jobs.ashbyhq.com/cohere' },
  { id: 'telesat', name: 'Telesat', type: 'lever', board: 'telesat', url: 'https://jobs.lever.co/telesat' },
  { id: 'vena', name: 'Vena Solutions', type: 'pinpoint', board: 'vena', url: 'https://www.lifeatvena.com/en' },
  { id: 'genesys', name: 'Genesys', type: 'workday', board: 'Genesys', url: 'https://genesys.wd1.myworkdayjobs.com/en-US/Genesys' },
  { id: 'celestica', name: 'Celestica', type: 'celestica', board: 'students', url: 'https://careers.celestica.com/go/Students-and-Interns/8944801/' },
  { id: 'veeva', name: 'Veeva Systems', type: 'lever', board: 'veeva', url: 'https://jobs.lever.co/veeva' }
];

export async function readPublicJson(url, fetchImpl) {
  const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json', 'User-Agent': 'CareerQueue/1.2.1' } });
  if (!response.ok) throw new Error(`来源返回 HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > 25_000_000) throw new Error('来源响应超过大小限制');
  return JSON.parse(text);
}

export function postingText(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—' };
  const decode = text => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, key) => {
    if (!key.startsWith('#')) return named[key.toLowerCase()] ?? all;
    const code = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
  });
  return decode(decode(String(value || '')).replace(/<li\b[^>]*>/gi, '\n• ').replace(/<br\s*\/?>|<\/(p|li|h[1-6]|div)>/gi, '\n').replace(/<[^>]*>/g, '')).replace(/\n{3,}/g, '\n\n').trim();
}

export function boardPosting(source, j, api) {
  if (!j || typeof j !== 'object') throw new Error('条目格式无效');
  if (source.type === 'pinpoint') {
    const url = pinpointUrl(j.url);
    if (!url || typeof j.title !== 'string' || !j.title.trim()) throw new Error('Pinpoint 职位链接 / 标题无效');
    return { company: source.name, title: j.title.trim(), url,
      jd: [j.description, j.key_responsibilities_header, j.key_responsibilities, j.skills_knowledge_expertise_header, j.skills_knowledge_expertise, j.benefits_header, j.benefits].filter(Boolean).map(postingText).join('\n\n'),
      location: j.location?.name || j.location?.city || 'Unknown',
      ...pinpointWorkMode(postingText(j.description), ({ remote: 'remote', hybrid: 'hybrid', onsite: 'onsite', on_site: 'onsite' })[j.workplace_type] || 'unknown', j.location?.name),
      salary: j.compensation_visible && typeof j.compensation === 'string' && j.compensation.trim() ? j.compensation : '未披露',
      postedAt: null, deadline: j.deadline_at || null, requisitionId: new URL(url).pathname.split('/').at(-1),
      sourceEvidence: { url: api, retrievedAt: new Date().toISOString(), note: 'Vena 官方公开职位列表；发布日期从对应详情核实。' },
      discoverySources: [{ id: source.id, name: source.name, url: source.url }], sourceLinks: [url] };
  }
  const gh = source.type === 'greenhouse', lever = source.type === 'lever';
  const id = String(j.id ?? '');
  if (!(gh ? /^\d+$/ : /^[a-f0-9-]{36}$/i).test(id)) throw new Error('岗位编号无效');
  const title = gh || !lever ? j.title : j.text;
  if (typeof title !== 'string' || !title.trim()) throw new Error('岗位标题缺失');
  const url = gh ? `https://job-boards.greenhouse.io/${source.board}/jobs/${id}` : `https://jobs.${lever ? 'lever.co' : 'ashbyhq.com'}/${source.board}/${id}`;
  const jd = gh ? postingText(j.content) : lever ? [j.descriptionPlain || postingText(j.description), ...(j.lists || []).map(l => `${l.text}\n${postingText(l.content)}`), j.additionalPlain, j.salaryDescriptionPlain].filter(Boolean).join('\n\n') : j.descriptionPlain || postingText(j.descriptionHtml);
  const location = gh ? j.location?.name : lever ? j.categories?.allLocations?.join(' / ') || j.categories?.location : [j.location, ...(j.secondaryLocations || []).map(x => x.location)].filter(Boolean).join(' / ');
  const range = lever ? j.salaryRange : null;
  const components = !gh && !lever ? (j.compensation?.summaryComponents || []).filter(c => c.compensationType === 'Salary' && Number.isFinite(c.minValue) && Number.isFinite(c.maxValue)) : [];
  const salary = range && Number.isFinite(range.min) && Number.isFinite(range.max) ? `${range.currency || '币种未注明'} ${range.min}–${range.max} / ${range.interval || '周期未注明'}` : components.length ? components.map(c => `${c.currencyCode || '币种未注明'} ${c.minValue}–${c.maxValue} / ${c.interval || '周期未注明'}`).join('; ') : j.compensation?.compensationTierSummary || '未披露';
  return { company: source.name, title: title.trim(), url, jd, location: location || 'Unknown', salary,
    workMode: ({ 'on-site': 'onsite', remote: 'remote', hybrid: 'hybrid', OnSite: 'onsite', Remote: 'remote', Hybrid: 'hybrid' })[j.workplaceType] || 'unknown',
    postedAt: gh ? j.first_published || null : lever ? null : j.publishedAt || null, postedAtKind: gh ? 'first' : lever ? 'official' : 'latest',
    deadline: typeof j.application_deadline === 'string' ? j.application_deadline : null,
    requisitionId: gh ? j.requisition_id || id : id,
    sourceEvidence: { url: api, retrievedAt: new Date().toISOString(), postedAtField: gh && j.first_published ? 'first_published' : !gh && !lever && j.publishedAt ? 'publishedAt' : null,
      requisitionIdField: gh && j.requisition_id ? 'requisition_id' : null, updatedAt: j.updated_at || null,
      note: gh ? '官方公开列表；updated_at 不是发布日期。' : lever ? '官方公开列表；createdAt 不是发布日期。' : '官方公开列表；publishedAt 是最近一次发布，可能重新发布。' },
    fieldEvidence: { ...(salary !== '未披露' ? { salary: { status: 'extracted', source: range ? 'salaryRange' : 'compensation', raw: salary, structured: range || components } } : {}),
      ...(j.workplaceType ? { workMode: { status: 'extracted', source: 'workplaceType', raw: j.workplaceType } } : {}) },
    discoverySources: [{ id: source.id, name: source.name, url: source.url }], sourceLinks: [url] };
}

export async function readEmployerBoard(source, fetchImpl = fetch) {
  if (source.id === 'qualcomm' && source.type === 'qualcomm' && source.board === 'canada-internships') return readQualcommBoard(source, fetchImpl);
  if (source.id === 'amazon' && source.type === 'amazon' && source.board === 'canada-internships') return readAmazonBoard(source, fetchImpl);
  if (source.id === 'celestica' && source.type === 'celestica' && source.board === 'students') return readCelesticaBoard(source, fetchImpl);
  if (source.id === 'genesys' && source.type === 'workday' && source.board === 'Genesys') return readGenesysBoard(source, fetchImpl);
  if (!/^[a-z0-9_-]+$/i.test(source.board) || !['greenhouse', 'ashby', 'lever', 'pinpoint'].includes(source.type) || source.type === 'pinpoint' && source.board !== 'vena') throw new Error('不支持的公开来源配置');
  const api = source.type === 'pinpoint' ? 'https://www.lifeatvena.com/en/postings.json' : source.type === 'greenhouse' ? `https://boards-api.greenhouse.io/v1/boards/${source.board}/jobs?content=true` : source.type === 'ashby' ? `https://api.ashbyhq.com/posting-api/job-board/${source.board}?includeCompensation=true` : `https://api.lever.co/v0/postings/${source.board}?mode=json`;
  const result = { ...source, api, status: 'complete', raw: 0, malformed: 0, pages: 0, jobs: [], error: null };
  const seen = new Set();
  try {
    for (let page = 0; page < 20; page++) {
      const data = await readPublicJson(source.type === 'lever' ? `${api}&limit=100&skip=${page * 100}` : api, fetchImpl);
      result.pages++;
      const rows = source.type === 'lever' ? data : source.type === 'pinpoint' ? data.data : data.jobs;
      if (!Array.isArray(rows)) throw new Error('公开列表格式变化');
      result.raw += rows.length;
      const before = seen.size;
      for (const j of rows) {
        if (source.type === 'ashby' && j?.isListed === false) continue;
        try {
          if (source.type === 'ashby' && j?.isListed !== true) throw new Error('缺少公开状态');
          const job = boardPosting(source, j, api);
          if (seen.has(job.url)) throw new Error('列表重复编号 / 分页未推进');
          seen.add(job.url); result.jobs.push(job);
        } catch { result.malformed++; }
      }
      if (source.type !== 'lever') {
        if (source.type === 'pinpoint' && (data.links?.next || data.meta?.next_page)) throw new Error('Pinpoint 返回更多分页，当前结果不完整');
        if (Number.isFinite(data.meta?.total) && data.meta.total !== rows.length) throw new Error('列表数量与总数不符，未完整取得');
        break;
      }
      if (rows.length < 100) break;
      if (seen.size === before) throw new Error('分页未推进，结果不完整');
      if (page === 19) throw new Error('达到分页上限，结果不完整');
    }
    if (result.malformed) throw new Error(`${result.malformed} 条格式异常或重复，结果不完整`);
  } catch (e) { result.status = result.pages ? 'partial' : 'failed'; result.error = e.message; }
  return result;
}

// Only the verified employer host is supported; never fetch arbitrary custom domains.
export function pinpointUrl(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.hostname !== 'www.lifeatvena.com' || u.port || u.username || u.password || !/^\/en\/postings\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}(?:\/applications\/new)?\/?$/i.test(u.pathname)) return null;
    u.pathname = u.pathname.replace(/\/$/, '').replace(/\/applications\/new$/, ''); u.search = ''; u.hash = ''; return u.href;
  } catch { return null; }
}

function pinpointWorkMode(jd, mode = 'unknown', location = '') {
  const options = jd.match(/[^\n.!?]*\bcan be\b[^\n.!?]*\bon[ -]?site\b[^\n.!?]*\bhybrid\b[^\n.!?]*\bremote\b[^\n.!?]*/i)?.[0]?.trim();
  if (options || mode === 'onsite' && /\bremote\b/i.test(location || '')) return { workMode: 'unknown',
    fieldEvidence: { workMode: { status: 'ambiguous', source: options ? 'JD：多种工作方式可选' : '官方字段与地点不一致', raw: options || `${mode} / ${location}` } } };
  return { workMode: mode, fieldEvidence: { workMode: { status: mode === 'unknown' ? 'not-extracted' : 'extracted', source: 'Pinpoint workplace_type', raw: mode === 'unknown' ? '' : mode } } };
}

export async function fetchPinpoint(candidate, fetchImpl = fetch) {
  const url = pinpointUrl(candidate.url);
  if (!url) throw new Error('不支持的 Pinpoint 职位地址');
  const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Accept: 'text/html' } });
  if (!response.ok) throw new Error(`Pinpoint HTTP ${response.status}`);
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > 2_000_000) throw new Error('Pinpoint 页面过大'); chunks.push(chunk); }
  const html = Buffer.concat(chunks).toString('utf8'), posts = [];
  const collect = x => { if (Array.isArray(x)) x.forEach(collect); else if (x && typeof x === 'object') { if ([x['@type']].flat().includes('JobPosting')) posts.push(x); if (x['@graph']) collect(x['@graph']); } };
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) { try { collect(JSON.parse(m[1])); } catch {} }
  const matches = [...new Map(posts.filter(p => p.identifier?.value === new URL(url).pathname.split('/').at(-1)).map(p => [JSON.stringify(p), p])).values()];
  if (matches.length !== 1 || !matches[0].title || !matches[0].description) throw new Error('Pinpoint 未返回唯一且编号相符的完整 JD');
  const p = matches[0], jd = postingText(p.description);
  if (!jd) throw new Error('Pinpoint JD 为空');
  const date = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(x) && Number.isFinite(Date.parse(x)) ? x : null;
  return { ...candidate, url, company: 'Vena Solutions', title: postingText(p.title), jd,
    location: [p.jobLocation].flat().filter(Boolean).map(l => l.name || [l.address?.addressLocality, l.address?.addressRegion, l.address?.addressCountry].filter(Boolean).join(', ')).join(' / ') || candidate.location || 'Unknown',
    requisitionId: p.identifier.value, postedAt: date(p.datePosted), postedAtKind: 'official', deadline: date(p.validThrough) || candidate.deadline || null,
    ...pinpointWorkMode(jd, candidate.workMode, candidate.location),
    sourceEvidence: { url, retrievedAt: new Date().toISOString(), postedAtField: 'JobPosting.datePosted', requisitionIdField: 'JobPosting.identifier' } };
}
