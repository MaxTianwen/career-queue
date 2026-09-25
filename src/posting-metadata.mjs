import { validPublicationDate } from '../web/job-facts.js';

export function parsePostingMetadata(html, title) {
  const posts = [];
  const collect = value => {
    if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') {
      if ([value['@type']].flat().includes('JobPosting')) posts.push(value);
      if (Array.isArray(value['@graph'])) value['@graph'].forEach(collect);
    }
  };
  for (const m of html.matchAll(/<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { collect(JSON.parse(m[1])); } catch { /* malformed source metadata is not a date */ }
  }
  const normalized = s => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const matches = posts.filter(p => normalized(p.title) === normalized(title));
  const dates = [...new Set(matches.map(p => p.datePosted).filter(validPublicationDate))];
  const deadlines = [...new Set(matches.map(p => p.validThrough).filter(validPublicationDate))];
  return { postedAt: dates.length === 1 ? dates[0] : null, deadline: deadlines.length === 1 ? deadlines[0] : null };
}

export async function postingMetadata(url, title, fetchImpl = fetch) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.port || u.username || u.password || !['jobs.lever.co', 'job-boards.greenhouse.io'].includes(u.hostname)) throw new Error('不允许的招聘元数据来源');
  try {
    const response = await fetchImpl(u.href, { redirect: 'error', signal: AbortSignal.timeout(10000), headers: { Accept: 'text/html' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 2_000_000) throw new Error('页面超过大小限制');
      chunks.push(chunk);
    }
    return { ...parsePostingMetadata(Buffer.concat(chunks).toString('utf8'), title), url: u.href, error: null };
  } catch (error) { return { postedAt: null, deadline: null, url: u.href, error: `发布日期补读失败：${error.message}` }; }
}
