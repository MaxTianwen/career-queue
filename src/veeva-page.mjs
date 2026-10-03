import { postingText } from './discovery-sources.mjs';
import { parsePostingMetadata } from './posting-metadata.mjs';

// Veeva can expose a linked posting page while omitting it from Lever's API.
// This reader follows only an explicitly supplied, public Veeva posting URL.
export async function fetchVeevaPage(candidate, fetchImpl = fetch) {
  const u = new URL(candidate.url);
  const match = u.pathname.match(/^\/veeva\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\/?$/i);
  if (u.protocol !== 'https:' || u.hostname !== 'jobs.lever.co' || u.port || u.username || u.password || !match) throw new Error('不支持的 Veeva 岗位链接');
  const url = `https://jobs.lever.co/veeva/${match[1]}`;
  const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Accept: 'text/html' } });
  if (!response.ok || response.redirected || response.url && response.url !== url) throw new Error(`Veeva 岗位页读取失败 HTTP ${response.status}`);
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 2_000_000) throw new Error('Veeva 岗位页超过大小限制');
    chunks.push(chunk);
  }
  const html = Buffer.concat(chunks).toString('utf8'), posts = [];
  const collect = value => {
    if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') {
      if ([value['@type']].flat().includes('JobPosting')) posts.push(value);
      if (value['@graph']) collect(value['@graph']);
    }
  };
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { collect(JSON.parse(m[1])); } catch { /* Invalid metadata cannot establish identity. */ }
  }
  const page = html.replace(/<!--[\s\S]*?-->|<(script|style|template)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  const titles = [...page.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)].map(m => postingText(m[1]));
  const normalized = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const matches = posts.filter(p => normalized(p.hiringOrganization?.name) === 'veeva systems' && titles.some(t => normalized(t) === normalized(p.title)));
  const applyLinks = [...page.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi)].map(m => m[1]).filter(link => /\/apply\/?(?:[?#]|$)/i.test(link));
  if (matches.length !== 1 || !applyLinks.length || applyLinks.some(link => link !== `${url}/apply`)) throw new Error('Veeva 岗位标题、公司或申请链接编号未能唯一核实');
  const p = matches[0], jd = postingText(p.description).replace(/\\n/g, '\n');
  if (!jd || jd.length < 80) throw new Error('Veeva 页面未提供完整 JD');
  const mode = postingText(page.match(/<div\b[^>]*class=["'][^"']*\bworkplaceTypes\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]).trim().toLowerCase();
  return { ...candidate, url, company: 'Veeva Systems', title: postingText(p.title), jd, requisitionId: match[1],
    location: p.jobLocation?.address?.addressLocality || candidate.location || 'Unknown',
    workMode: ({ 'on-site': 'onsite', hybrid: 'hybrid', remote: 'remote' })[mode] || 'unknown',
    ...parsePostingMetadata(html, p.title), postedAtKind: 'official',
    sourceEvidence: { url, retrievedAt: new Date().toISOString(), postedAtField: 'JobPosting.datePosted', requisitionIdField: 'verified application URL',
      note: 'Lever 单岗 API 返回 404，改从编号相符的 Veeva 官方岗位页读取；公开列表未列出不等于岗位关闭，也不代表列表已覆盖此岗位。' } };
}
