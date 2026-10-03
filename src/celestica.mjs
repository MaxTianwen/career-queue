import { postingText } from './discovery-sources.mjs';

const origin = 'https://careers.celestica.com';
const board = '/go/Students-and-Interns/8944801/';
const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*["']([^"']*)["']/g)].map(m => [m[1].toLowerCase(), m[2]]));
export function celesticaUrl(value) {
  try {
    const u = new URL(value);
    if (u.origin !== origin || u.username || u.password || !/^\/job\/[^/]+\/\d+\/?$/.test(u.pathname) || /[\\/\x00-\x20]/.test(decodeURIComponent(u.pathname.split('/')[2]))) return null;
    if (!u.pathname.endsWith('/')) u.pathname += '/';
    u.search = ''; u.hash = ''; return u.href;
  } catch { return null; }
}
async function html(url, fetchImpl) {
  const r = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Accept: 'text/html' } });
  if (!r.ok) throw new Error(`Celestica HTTP ${r.status}`);
  const chunks = []; let size = 0;
  for await (const chunk of r.body) { size += chunk.length; if (size > 2_000_000) throw new Error('Celestica 页面过大'); chunks.push(chunk); }
  return Buffer.concat(chunks).toString('utf8');
}
export function parseCelesticaList(page) {
  const summary = postingText(page.match(/<span\b[^>]*class="paginationLabel"[^>]*>([\s\S]*?)<\/span>/i)?.[1]);
  const count = summary.match(/^Results\s+([\d,]+)\s*[–-]\s*([\d,]+)\s+of\s+([\d,]+)$/);
  if (!count) throw new Error('Celestica 列表缺少可核对总数');
  const [start, end, total] = count.slice(1).map(v => Number(v.replaceAll(',', ''))), jobs = [];
  for (const row of page.matchAll(/<tr\b[^>]*class="data-row"[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const links = [...row[1].matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].filter(m => /(?:^|\s)jobTitle-link(?:\s|$)/.test(attrs(m[1]).class || ''));
    const link = links[0], url = link && celesticaUrl(new URL(attrs(link[1]).href, origin).href);
    const title = link && postingText(link[2]);
    const location = postingText(row[1].match(/<td\b[^>]*class="colLocation[^"\n]*"[^>]*>([\s\S]*?)<\/td>/i)?.[1]);
    if (!url || !title || !location || jobs.some(j => j.url === url)) throw new Error('Celestica 列表职位缺少字段或重复');
    jobs.push({ company: 'Celestica', title, url, location, jd: '', postedAt: null, workMode: 'unknown', salary: '未披露' });
  }
  if (start < 1 || end < start || end > total || jobs.length !== end - start + 1) throw new Error('Celestica 列表数量与分页不符');
  return { start, end, total, jobs };
}
export async function readCelesticaBoard(source, fetchImpl) {
  const api = origin + board;
  const result = { ...source, api, status: 'complete', raw: 0, pages: 0, malformed: 0, jobs: [], error: null };
  const seen = new Set(); let offset = 0, total;
  try {
    for (let n = 0; n < 20; n++) {
      const url = api + (offset ? `${offset}/` : '');
      const page = parseCelesticaList(await html(url, fetchImpl));
      if (page.start !== offset + 1 || total !== undefined && total !== page.total) throw new Error('Celestica 分页未推进或总数变化');
      total = page.total; result.pages++; result.raw += page.jobs.length;
      for (const job of page.jobs) {
        if (seen.has(job.url)) throw new Error('Celestica 分页重复职位');
        seen.add(job.url); result.jobs.push({ ...job, sourceLinks: [job.url], discoverySources: [{ id: source.id, name: source.name, url: source.url }], sourceEvidence: { url, retrievedAt: new Date().toISOString(), note: 'Celestica 官方学生职位列表；日期与编号另从对应详情核实。' } });
      }
      if (page.end === total) break;
      offset = page.end;
      if (n === 19) throw new Error('Celestica 已达分页上限，结果不完整');
    }
  } catch (error) { result.status = result.pages ? 'partial' : 'failed'; result.error = error.message; }
  return result;
}

// Description contains nested spans; take the complete matching element only.
function description(page) {
  const opening = /<span\b[^>]*itemprop="description"[^>]*>/i.exec(page);
  if (!opening) return '';
  const start = opening.index + opening[0].length;
  let depth = 1;
  for (const token of page.slice(start).matchAll(/<\/?span\b[^>]*>/gi)) {
    depth += token[0].startsWith('</') ? -1 : 1;
    if (!depth) return postingText(page.slice(start, start + token.index));
  }
  return '';
}
export function parseCelesticaJob(page, candidate) {
  const url = celesticaUrl(candidate.url);
  if (!url) throw new Error('不支持的 Celestica 职位地址');
  const canonical = [...page.matchAll(/<link\b[^>]*>/gi)].map(m => attrs(m[0])).find(a => a.rel === 'canonical')?.href;
  const id = new URL(url).pathname.split('/').at(-2);
  const jd = description(page), requisitionId = jd.match(/^[\s\u200b\ufeff]*Req ID:\s*(\d+)\b/m)?.[1];
  const title = postingText(page.match(/<h1\b[^>]*itemprop="title"[^>]*>([\s\S]*?)<\/h1>/i)?.[1]);
  if (celesticaUrl(canonical) !== url || !page.includes(`/talentcommunity/apply/${id}/`) || !title || !jd || !requisitionId) throw new Error('Celestica 未返回与页面编号相符的完整职位');
  const meta = Object.fromEntries([...page.matchAll(/<meta\b[^>]*>/gi)].map(m => attrs(m[0])).filter(a => a.itemprop).map(a => [a.itemprop, a.content]));
  const date = /^\w{3} \w{3} \d{2} 00:00:00 UTC \d{4}$/.test(meta.datePosted || '') && Number.isFinite(Date.parse(meta.datePosted)) ? new Date(meta.datePosted).toISOString().slice(0, 10) : null;
  const mode = jd.match(/^Remote Position:\s*(Hybrid|Remote|On[ -]?site)\s*$/mi)?.[1]?.toLowerCase();
  const salary = jd.match(/^Hourly Wage:\s*([^\n]+)$/mi)?.[1]?.trim();
  return { ...candidate, company: 'Celestica', title, url, jd, requisitionId,
    location: [meta.addressLocality, meta.addressRegion, meta.addressCountry].filter(Boolean).join(', ') || candidate.location || 'Unknown',
    postedAt: date, postedAtKind: 'official', deadline: null, workMode: mode?.startsWith('on') ? 'onsite' : mode || 'unknown', salary: salary || '未披露',
    sourceEvidence: { url, retrievedAt: new Date().toISOString(), postedAtField: date ? 'JobPosting datePosted' : null, requisitionIdField: 'JD Req ID' },
    fieldEvidence: { ...(mode ? { workMode: { status: 'extracted', source: 'JD Remote Position', raw: mode } } : {}), ...(salary ? { salary: { status: 'extracted', source: 'JD Hourly Wage', raw: salary } } : {}) } };
}
export async function fetchCelestica(candidate, fetchImpl = fetch) {
  const url = celesticaUrl(candidate.url);
  if (!url) throw new Error('不支持的 Celestica 职位地址');
  return parseCelesticaJob(await html(url, fetchImpl), { ...candidate, url });
}
