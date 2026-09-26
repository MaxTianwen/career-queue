// Public, read-only Job Board API. No arbitrary-URL fetches or application endpoints.
import { postingMetadata } from './posting-metadata.mjs';
export async function fetchGreenhouse(url, company, fetchImpl = fetch) {
  const parsed = new URL(url);
  const match = parsed.pathname.match(/^\/([a-z0-9_-]+)\/jobs\/(\d+)\/?$/i);
  if (parsed.protocol !== 'https:' || !['boards.greenhouse.io', 'job-boards.greenhouse.io'].includes(parsed.hostname) || parsed.port || parsed.username || parsed.password || !match) {
    throw new Error('此入口仅支持 Greenhouse 官方 /公司/jobs/数字ID 职位链接；其他来源请通过自动搜岗读取，或粘贴完整 JD');
  }
  if (!company?.trim()) throw new Error('请提供官方公司名称 --company');
  const [, board, postId] = match;
  const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${postId}`;
  const response = await fetchImpl(apiUrl, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Greenhouse HTTP ${response.status}，未导入职位`);
  const source = await response.json();
  if (!source.title || !source.content || String(source.id) !== postId) throw new Error('Greenhouse 未返回完整岗位内容');
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—' };
  const decode = text => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, key) => {
    if (!key.startsWith('#')) return named[key.toLowerCase()] ?? all;
    const code = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
  });
  const html = decode(source.content);
  const jd = decode(html.replace(/<li\b[^>]*>/gi, '\n• ').replace(/<br\s*\/?>|<\/(p|h[1-6]|li|div)>/gi, '\n').replace(/<[^>]*>/g, '')).replace(/\n{3,}/g, '\n\n').trim();
  const terms = [...source.title.matchAll(/\b(Summer|Fall|Winter|Spring)\s+(20\d{2})\b/gi)].map(m => `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}`);
  const metadata = source.first_published ? null : await postingMetadata(`https://job-boards.greenhouse.io/${board}/jobs/${postId}`, source.title, fetchImpl);
  return { company: company.trim(), title: source.title,
    url: `https://job-boards.greenhouse.io/${board}/jobs/${postId}`, jd,
    requisitionId: source.requisition_id || postId, term: terms.length === 1 ? terms[0] : 'Unknown',
    location: source.location?.name ?? 'Unknown', workMode: 'unknown', durationMonths: null,
    isIntern: /\b(intern(?:ship)?|co[ -]?op)\b/i.test(source.title) ? true : null,
    relevant: null, paid: null, meetsMinimumWage: null, postedAt: source.first_published || metadata?.postedAt || null,
    postedAtKind: source.first_published ? 'first' : 'official', deadline: metadata?.deadline || null,
    salary: '未披露', coverLetterRequired: null,
    sourceEvidence: { url: apiUrl, retrievedAt: new Date().toISOString(), postedAtField: source.first_published ? 'first_published' : metadata?.postedAt ? 'JobPosting.datePosted' : null,
      publicationUrl: metadata?.url, publicationError: metadata?.error, requisitionIdField: source.requisition_id ? 'requisition_id' : null,
      updatedAt: source.updated_at ?? null, note: '未将 updated_at 当发布时间。薪资 / 任期 / 办公方式等须根据完整 JD 补充后导入。' } };
}
