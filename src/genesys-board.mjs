import { workdayUrl } from './workday.mjs';

// The public careers site's listing endpoint, not a global Workday search API.
export async function readGenesysBoard(source, fetchImpl) {
  const api = 'https://genesys.wd1.myworkdayjobs.com/wday/cxs/genesys/Genesys/jobs';
  const result = { ...source, api, status: 'complete', raw: 0, malformed: 0, pages: 0, jobs: [], error: null };
  const seen = new Set(); let expected;
  try {
    for (let page = 0; page < 25; page++) {
      const response = await fetchImpl(api, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: page * 20, searchText: '' }) });
      if (!response.ok) throw new Error(`公开列表 HTTP ${response.status}`);
      const text = await response.text();
      if (text.length > 2_000_000) throw new Error('公开列表响应过大');
      const data = JSON.parse(text);
      if (!Array.isArray(data.jobPostings) || data.jobPostings.length > 20) throw new Error('公开列表格式变化');
      // Subsequent pages currently return total: 0; only page one supplies the total.
      if (page === 0) {
        if (!Number.isInteger(data.total) || data.total < 0) throw new Error('公开列表缺少总数');
        expected = data.total;
      } else if (data.total > 0 && data.total !== expected) throw new Error('分页期间总数变化，请重试');
      result.pages++; result.raw += data.jobPostings.length;
      for (const item of data.jobPostings) {
        try {
          if (typeof item.title !== 'string' || !item.title.trim() || typeof item.externalPath !== 'string' || !/^\/job\//.test(item.externalPath) || /[?#\\]/.test(item.externalPath)) throw new Error('无效职位');
          const { url, slug } = workdayUrl(`https://genesys.wd1.myworkdayjobs.com/en-US/Genesys${item.externalPath}`);
          const id = slug.match(/_(JR\d+)(?:-\d+)?$/i)?.[1];
          if (!id || !Array.isArray(item.bulletFields) || !item.bulletFields.includes(id) || seen.has(url)) throw new Error('编号不符或重复');
          seen.add(url);
          result.jobs.push({ company: 'Genesys', title: item.title.trim(), url, jd: '',
            location: typeof item.locationsText === 'string' ? item.locationsText : 'Unknown', requisitionId: id,
            postedAt: null, workMode: 'unknown', salary: '未披露',
            sourceEvidence: { url: api, retrievedAt: new Date().toISOString(), note: 'Genesys 公开招聘列表；相对发布时间不换算为首次发布日期，正文另行读取。' },
            discoverySources: [{ id: source.id, name: source.name, url: source.url }], sourceLinks: [url] });
        } catch { result.malformed++; }
      }
      if (result.raw >= expected) {
        if (result.raw !== expected) throw new Error('列表数量与总数不符');
        break;
      }
      if (data.jobPostings.length < 20) throw new Error('分页提前结束，结果不完整');
      if (page === 24) throw new Error('达到 500 条读取上限，结果不完整');
    }
    if (result.malformed) throw new Error(`${result.malformed} 条格式异常或重复，结果不完整`);
  } catch (error) { result.status = result.pages ? 'partial' : 'failed'; result.error = error.message; }
  return result;
}
