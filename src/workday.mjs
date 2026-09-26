import { validPublicationDate } from '../web/job-facts.js';

// Public JobPosting JSON-LD only: no login, private API or application endpoint.
export function workdayUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.port || url.username || url.password ||
      !/^[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com$/.test(url.hostname)) throw new Error('不支持的 Workday 官方职位链接');
  const path = url.pathname.replace(/\/$/, '').split('/').slice(1);
  if (/^[a-z]{2}-[a-z]{2}$/i.test(path[0])) path.shift();
  if (path.at(-1) === 'apply') path.pop();
  if (!/^[a-z0-9_-]+$/i.test(path[0]) || path[1] !== 'job' || path.length < 3 || path.length > 5) throw new Error('Workday 链接不是公开职位详情');
  for (const part of path) {
    if (!part || /[\\/\x00-\x20?#]/.test(decodeURIComponent(part)) || ['.', '..'].includes(decodeURIComponent(part))) throw new Error('Workday 职位路径无效');
  }
  url.pathname = url.pathname.replace(/\/$/, '').replace(/\/apply$/, '');
  url.search = ''; url.hash = '';
  return { url: url.href, slug: decodeURIComponent(path.at(-1)) };
}

const decode = value => String(value).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|ndash|mdash);/gi, (all, entity) => {
  if (!entity.startsWith('#')) return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—' }[entity.toLowerCase()];
  const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
});
const plain = value => decode(String(value).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
  .replace(/<li\b[^>]*>/gi, '\n• ')
  .replace(/<br\s*\/?>|<\/(?:p|div|li|h[1-6])>/gi, '\n').replace(/<[^>]*>/g, '')).trim();

export function parseWorkday(html, candidate) {
  const { url, slug } = workdayUrl(candidate.url);
  const posts = [];
  const collect = value => {
    if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') {
      if ([value['@type']].flat().includes('JobPosting')) posts.push(value);
      if (Array.isArray(value['@graph'])) value['@graph'].forEach(collect);
    }
  };
  for (const match of html.matchAll(/<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { collect(JSON.parse(match[1])); } catch { /* Malformed metadata is not a job. */ }
  }
  const matching = posts.filter(post => {
    const id = String(post.identifier?.value ?? '');
    if (!/^[a-z0-9_-]{1,100}$/i.test(id)) return false;
    // A numeric posting suffix can follow the employer requisition.
    return new RegExp(`_${id}(?:-\\d+)?$`, 'i').test(slug);
  });
  const unique = [...new Map(matching.map(post => [JSON.stringify(post), post])).values()];
  if (unique.length !== 1) throw new Error(unique.length ? 'Workday 职位结构化数据冲突，需核实' : 'Workday 页面未提供与链接招聘编号相符的 JobPosting；可能已撤岗或页面格式变化');
  const post = unique[0];
  if (typeof post.title !== 'string' || typeof post.description !== 'string' || !plain(post.title) || !plain(post.description)) throw new Error('Workday 未返回完整标题或 JD');
  const locations = [post.jobLocation].flat().filter(Boolean).map(place => {
    const address = place.address || {};
    return [...new Set([address.addressLocality, address.addressRegion, typeof address.addressCountry === 'string' ? address.addressCountry : address.addressCountry?.name].filter(v => typeof v === 'string' && v.trim()).map(plain))].join(', ');
  }).filter(Boolean);
  const jd = plain(post.description);
  const tags = [...new Set([...jd.matchAll(/#LI-(Hybrid|Remote|Onsite)\b/gi)].map(m => m[1].toLowerCase()))];
  // TELECOMMUTE also appears on hybrid jobs. Do not infer full remote from it.
  const workMode = tags.length === 1 ? tags[0] : 'unknown';
  const pay = post.baseSalary, amount = pay?.value;
  const unit = { HOUR: 'hour', DAY: 'day', WEEK: 'week', MONTH: 'month', YEAR: 'year' }[amount?.unitText];
  const currency = /^[A-Z]{3}$/.test(pay?.currency || '') ? pay.currency : null;
  const value = Number.isFinite(amount?.value) ? String(amount.value) : Number.isFinite(amount?.minValue) && Number.isFinite(amount?.maxValue) && amount.minValue <= amount.maxValue ? `${amount.minValue}–${amount.maxValue}` : null;
  const postedAt = validPublicationDate(post.datePosted) ? post.datePosted : null;
  const deadline = validPublicationDate(post.validThrough) ? post.validThrough : null;
  return { ...candidate, url, title: plain(post.title), jd, requisitionId: String(post.identifier.value),
    location: locations.join(' / ') || candidate.location || 'Unknown', workMode,
    salary: currency && unit && value !== null ? `${currency} ${value} / ${unit}` : '未披露',
    postedAt, postedAtKind: 'official', deadline, deadlineEvidence: deadline ? '官方 JobPosting.validThrough' : null,
    sourceEvidence: { url, retrievedAt: new Date().toISOString(), requisitionIdField: 'JobPosting.identifier',
      postedAtField: postedAt ? 'JobPosting.datePosted' : null, deadlineField: deadline ? 'JobPosting.validThrough' : null,
      jobLocationType: post.jobLocationType || null,
      note: '读取官方公开页面 JobPosting 正文；日期保留原精度，未用相对日期或索引时间推算。TELECOMMUTE 不直接认定全程远程；薪资未结构化提供时仍待核实。' } };
}

export async function fetchWorkday(candidate, fetchImpl = fetch) {
  const { url } = workdayUrl(candidate.url);
  const response = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { Accept: 'text/html', 'User-Agent': 'CareerQueue/1.0' } });
  if (!response.ok) throw new Error(`Workday HTTP ${response.status}${response.status >= 300 && response.status < 400 ? "（页面重定向，未跟随）" : ""}，未取得全文`);
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 2_000_000) throw new Error('Workday 页面超过大小限制');
    chunks.push(chunk);
  }
  return parseWorkday(Buffer.concat(chunks).toString('utf8'), candidate);
}
