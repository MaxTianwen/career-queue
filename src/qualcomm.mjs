import { postingText, readPublicJson } from './discovery-sources.mjs';

const origin = 'https://careers.qualcomm.com';
export const qualcommSearchUrl = (query, start = 0) => `${origin}/api/pcsx/search?domain=qualcomm.com&query=${encodeURIComponent(query)}&location=Canada&start=${start}`;
export const qualcommDetailUrl = id => `${origin}/api/pcsx/position_details?position_id=${id}&domain=qualcomm.com&hl=en`;

export function qualcommUrl(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || !['careers.qualcomm.com', 'qualcomm.eightfold.ai'].includes(u.hostname) || u.port || u.username || u.password) return null;
    const match = u.pathname.match(/^\/careers\/job\/(\d+)\/?$/);
    return match ? `${origin}/careers/job/${match[1]}` : null;
  } catch { return null; }
}

function payload(data) {
  if (data?.status !== 200 || data.error?.message || data.error?.body || data.metadata?.isFallback || !data.data) throw new Error('Qualcomm 未返回有效的公开岗位数据');
  return data.data;
}

export function qualcommPosting(item, api, full = false) {
  const id = String(item?.id || ''), req = String(item?.displayJobId || '');
  const url = qualcommUrl(`${origin}${item?.positionUrl}`);
  if (!/^\d+$/.test(id) || !/^\d+$/.test(req) || String(item.atsJobId) !== req || url !== `${origin}/careers/job/${id}` || typeof item.name !== 'string' || !item.name.trim()) throw new Error('Qualcomm 岗位编号 / 招聘编号 / 链接不符');
  if (!Array.isArray(item.locations) || !item.locations.length || item.locations.some(l => typeof l !== 'string' || !l.trim())) throw new Error('Qualcomm 岗位地点缺失');
  const jd = full && typeof item.jobDescription === 'string' ? postingText(item.jobDescription) : '';
  if (full && (!jd || qualcommUrl(item.publicUrl) !== url)) throw new Error('Qualcomm 缺少对应岗位的完整正文');
  // postedTs agrees with the public page datePosted; creationTs is not publication.
  const postedAt = Number.isInteger(item.postedTs) && item.postedTs >= 946684800 && item.postedTs < 4102444800 ? new Date(item.postedTs * 1000).toISOString().slice(0, 10) : null;
  const workMode = ['onsite', 'remote', 'hybrid'].includes(item.workLocationOption) ? item.workLocationOption : 'unknown';
  return { company: 'Qualcomm', title: item.name.trim(), url, requisitionId: req, jd,
    location: item.locations.join(' / '), workMode, postedAt, postedAtKind: 'official', salary: '未披露', deadline: null,
    sourceEvidence: { url: api, retrievedAt: new Date().toISOString(), requisitionIdField: 'requisition_id', postedAtField: postedAt ? 'postedTs' : null,
      note: 'Qualcomm 官方公开招聘数据；displayJobId 与 atsJobId 核对，网页 ID 不当作招聘编号。postedTs 保留日期精度，creationTs 不作为发布日期。' },
    fieldEvidence: workMode !== 'unknown' ? { workMode: { status: 'extracted', source: 'workLocationOption', raw: item.workLocationOption } } : {} };
}

export async function readQualcommBoard(source, fetchImpl) {
  const result = { ...source, api: qualcommSearchUrl('intern'), status: 'complete', raw: 0, pages: 0, malformed: 0, jobs: [], error: null };
  const combined = new Set();
  try {
    for (const query of ['intern', 'co-op']) {
      let start = 0, total;
      const seen = new Set();
      for (let page = 0; page < 20; page++) {
        const api = qualcommSearchUrl(query, start), data = payload(await readPublicJson(api, fetchImpl));
        if (!Number.isInteger(data.count) || data.count < 0 || !Array.isArray(data.positions) || data.positions.length > 10) throw new Error('Qualcomm 列表格式变化');
        if (total !== undefined && total !== data.count) throw new Error('Qualcomm 分页总数变化，请重试');
        total = data.count; result.pages++; result.raw += data.positions.length;
        for (const row of data.positions) {
          try {
            const job = qualcommPosting(row, api);
            if (!row.locations.some(l => /\bCanada\b/i.test(l)) || seen.has(job.url)) throw new Error('地区不符或分页重复');
            seen.add(job.url);
            if (!combined.has(job.url)) {
              combined.add(job.url);
              result.jobs.push({ ...job, sourceLinks: [job.url], discoverySources: [{ id: source.id, name: source.name, url: source.url }] });
            }
          } catch { result.malformed++; }
        }
        start += data.positions.length;
        if (start === total) break;
        if (data.positions.length < 10 || start > total || page === 19) throw new Error('Qualcomm 分页提前结束或达到上限，结果不完整');
      }
    }
    if (result.malformed) throw new Error(`${result.malformed} 条格式异常、重复或地区不符，结果不完整`);
  } catch (error) { result.status = result.pages ? 'partial' : 'failed'; result.error = error.message; }
  return result;
}

export async function fetchQualcomm(candidate, fetchImpl = fetch) {
  const url = qualcommUrl(candidate.url);
  if (!url) throw new Error('不支持的 Qualcomm 职位地址');
  const api = qualcommDetailUrl(new URL(url).pathname.split('/').at(-1));
  const job = qualcommPosting(payload(await readPublicJson(api, fetchImpl)), api, true);
  if (job.url !== url || candidate.requisitionId && job.requisitionId !== String(candidate.requisitionId)) throw new Error('Qualcomm 返回的岗位或招聘编号不一致');
  return { ...candidate, ...job };
}
