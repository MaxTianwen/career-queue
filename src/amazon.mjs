import { postingText, readPublicJson } from './discovery-sources.mjs';
import { validPublicationDate } from '../web/job-facts.js';

// Public careers search, bounded to two Canadian internship queries for discovery.
export const amazonSearchUrl = (query, offset = 0, canada = false) => `https://www.amazon.jobs/en/search.json?base_query=${encodeURIComponent(query)}${canada ? '&country=CAN' : ''}&offset=${offset}&result_limit=100`;

export function amazonUrl(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || !['amazon.jobs', 'www.amazon.jobs'].includes(u.hostname) || u.port || u.username || u.password || !/^\/en\/jobs\/\d+(?:\/[a-z0-9-]+)?\/?$/i.test(u.pathname)) return null;
    u.hostname = 'www.amazon.jobs'; u.search = ''; u.hash = ''; u.pathname = u.pathname.replace(/\/$/, '');
    return u.href;
  } catch { return null; }
}

export function amazonPosting(item, api) {
  const id = String(item?.id_icims || '');
  const url = typeof item?.job_path === 'string' && item.job_path.startsWith('/en/jobs/') ? amazonUrl(`https://www.amazon.jobs${item.job_path}`) : null;
  if (!/^\d+$/.test(id) || !url || new URL(url).pathname.split('/')[3] !== id || typeof item.title !== 'string' || !item.title.trim()) throw new Error('Amazon 职位编号 / 链接 / 标题不符');
  if (typeof item.description !== 'string' || !postingText(item.description) || typeof item.basic_qualifications !== 'string' || !postingText(item.basic_qualifications)) throw new Error('Amazon 缺少完整正文或基本要求');
  const jd = ['Description', postingText(item.description), 'Basic Qualifications', postingText(item.basic_qualifications), ...(item.preferred_qualifications ? ['Preferred Qualifications', postingText(item.preferred_qualifications)] : [])].join('\n\n');
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const date = typeof item.posted_date === 'string' && item.posted_date.match(/^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/);
  const posted = date && `${date[3]}-${String(months.indexOf(date[1]) + 1).padStart(2, '0')}-${date[2].padStart(2, '0')}`;
  const starts = jd.split('\n').filter(line => /\bstarts?\b/i.test(line));
  const seasons = new Set(starts.flatMap(line => [...line.matchAll(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/g)].map(m => `${months.indexOf(m[1]) < 3 ? 'Winter' : m[1] === 'April' ? 'Spring' : months.indexOf(m[1]) < 8 ? 'Summer' : 'Fall'} ${m[2]}`)));
  return { company: 'Amazon', title: item.title.trim(), url, jd, fullJd:true,
    location: [item.location || item.normalized_location || 'Unknown', item.country_code === 'CAN' ? 'Canada' : item.country_code].filter(Boolean).join(', '),
    requisitionId: id, postedAt: posted && validPublicationDate(posted) ? posted : null, postedAtKind: 'official',
    deadline: null, workMode: 'unknown', salary: '未披露',
    fieldEvidence: seasons.size > 1 ? { term: { status: 'options', source: 'Amazon JD：多个入职时间选项', raw: starts.join('\n') } } : {},
    sourceEvidence: { url: api, retrievedAt: new Date().toISOString(), postedAtField: 'posted_date', requisitionIdField: 'requisition_id', note: 'Amazon 官方公开招聘搜索；posted_date 是日期，updated_time 不作为发布日期。多个入职选项保留原文，不任选一个批次。' } };
}

function searchRows(data) {
  if (data.error || !Array.isArray(data.jobs) || !Number.isInteger(data.hits) || data.hits < 0 || data.jobs.length > 100) throw new Error('Amazon 公开列表格式变化');
  return data.jobs;
}

export async function readAmazonBoard(source, fetchImpl) {
  const result = { ...source, api: amazonSearchUrl('intern', 0, true), status: 'complete', raw: 0, malformed: 0, pages: 0, jobs: [], error: null };
  const combined = new Set();
  try {
    for (const query of ['intern', 'co-op']) {
      const seen = new Set(); let expected;
      for (let page = 0; page < 10; page++) {
        const api = amazonSearchUrl(query, page * 100, true);
        const data = await readPublicJson(api, fetchImpl), rows = searchRows(data);
        if (page === 0) expected = data.hits;
        if (data.hits !== expected) throw new Error('Amazon 分页总数变化，请重试');
        result.pages++; result.raw += rows.length;
        for (const row of rows) {
          try {
            if (row.country_code !== 'CAN') throw new Error('加拿大筛选未生效');
            const job = amazonPosting(row, api);
            if (seen.has(job.requisitionId)) throw new Error('分页重复编号');
            seen.add(job.requisitionId);
            if (!combined.has(job.requisitionId)) {
              combined.add(job.requisitionId);
              result.jobs.push({ ...job, discoverySources: [{ id: source.id, name: source.name, url: source.url }], sourceLinks: [job.url] });
            }
          } catch { result.malformed++; }
        }
        if ((page * 100 + rows.length) === expected) break;
        if (rows.length < 100 || page === 9) throw new Error('Amazon 分页提前结束或达到读取上限，结果不完整');
      }
    }
    if (result.malformed) throw new Error(`${result.malformed} 条格式异常、重复或地区不符，结果不完整`);
  } catch (error) { result.status = result.pages ? 'partial' : 'failed'; result.error = error.message; }
  return result;
}

export async function fetchAmazon(candidate, fetchImpl = fetch) {
  const url = amazonUrl(candidate.url);
  if (!url) throw new Error('不支持的 Amazon 职位地址');
  const id = new URL(url).pathname.split('/')[3], api = amazonSearchUrl(id);
  const data = await readPublicJson(api, fetchImpl), rows = searchRows(data);
  const matches = rows.filter(row => String(row.id_icims) === id);
  if (matches.length !== 1) throw new Error('Amazon 当前公开搜索未返回唯一对应编号；不能据此判断已关闭');
  const job = amazonPosting(matches[0], api);
  return { ...candidate, ...job };
}
