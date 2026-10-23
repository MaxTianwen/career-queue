import { EMPLOYER_SOURCES, readEmployerBoard } from './discovery-sources.mjs';
import { workdayUrl } from './workday.mjs';

// Employer boards are learned from links the public index has already published for
// Canadian roles, never guessed: a Workday site name or ATS slug only comes from a real URL.
const CANADA =
  /\b(?:canada|ontario|quebec|québec|british columbia|alberta|toronto|markham|vaughan|waterloo|kitchener|ottawa|kanata|montreal|montréal|vancouver|burnaby|richmond hill|mississauga|oakville|calgary|edmonton|halifax|winnipeg)\b|,\s*(?:ON|BC|QC|AB|MB|NS|NB|SK|NL|PE)\b/i;
const known = new Set(EMPLOYER_SOURCES.map(s => `${s.type}:${s.board}`.toLowerCase()));

export function boardFromUrl(value) {
  let u;
  try {
    u = new URL(value);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.port || u.username || u.password) return null;
  const parts = u.pathname.split('/').filter(Boolean);
  const wd = u.hostname.match(/^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$/);
  if (wd) {
    const locale = /^[a-z]{2}-[a-z]{2}$/i.test(parts[0] || '') ? parts.shift() : null;
    if (!/^[a-z0-9_-]+$/i.test(parts[0] || '') || parts[1] !== 'job') return null;
    return {
      type: 'workday',
      board: `${wd[1]}/${parts[0]}`,
      tenant: wd[1],
      site: parts[0],
      // Keep the published locale so generated links equal the index links and merge with them.
      base: `https://${u.hostname}/${locale ? locale + '/' : ''}${parts[0]}`
    };
  }
  const slug = (re, i = 0) => (re.test(parts[i] || '') ? parts[i] : null);
  if (['boards.greenhouse.io', 'job-boards.greenhouse.io'].includes(u.hostname)) {
    const board = u.searchParams.get('for') || slug(/^[a-z0-9_-]+$/i);
    return board && /^[a-z0-9_-]+$/i.test(board) && board !== 'embed' ? { type: 'greenhouse', board } : null;
  }
  if (u.hostname === 'jobs.lever.co') return slug(/^[a-z0-9_-]+$/i) ? { type: 'lever', board: parts[0] } : null;
  if (u.hostname === 'jobs.ashbyhq.com') return slug(/^[a-z0-9_-]+$/i) ? { type: 'ashby', board: parts[0] } : null;
  return null;
}

// Index entries (any term) with a Canadian location in the last `days`; one board per employer site.
export function boardRegistry(entries, { now = Date.now(), days = 400, limit = 400 } = {}) {
  const boards = new Map();
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e || typeof e.url !== 'string' || !Array.isArray(e.locations) || !e.locations.some(l => CANADA.test(l))) continue;
    if (!Number.isFinite(e.date_posted) || now - e.date_posted * 1000 > days * 86400000) continue;
    const board = boardFromUrl(e.url);
    if (!board || known.has(`${board.type}:${board.board}`.toLowerCase())) continue;
    const key = `${board.type}:${board.board}`.toLowerCase(),
      seen = boards.get(key);
    if (seen) {
      seen.hits++;
      seen.lastSeen = Math.max(seen.lastSeen, e.date_posted);
    } else
      boards.set(key, {
        ...board,
        id: 'board:' + key,
        name: String(e.company_name || board.board).slice(0, 200),
        url: board.base || e.url,
        hits: 1,
        lastSeen: e.date_posted
      });
  }
  return [...boards.values()].sort((a, b) => b.lastSeen - a.lastSeen || b.hits - a.hits).slice(0, limit);
}

async function workdayPage(source, body, fetchImpl) {
  const api = `https://${new URL(source.base).hostname}/wday/cxs/${source.tenant}/${source.site}/jobs`;
  const response = await fetchImpl(api, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`公开列表 HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > 2_000_000) throw new Error('公开列表响应过大');
  const data = JSON.parse(text);
  if (!Array.isArray(data.jobPostings) || data.jobPostings.length > 20) throw new Error('公开列表格式变化');
  return { api, data };
}

// The facet id for Canada differs by tenant (locationCountry, Location_Country, locationHierarchy1…).
export function canadaFacet(facets = []) {
  for (const facet of facets) {
    for (const value of facet.values || []) {
      if (/^canada$/i.test(value.descriptor || '') && typeof value.id === 'string') return { [facet.facetParameter]: [value.id] };
      if (value.facetParameter && Array.isArray(value.values)) {
        const nested = canadaFacet([value]);
        if (nested) return nested;
      }
    }
  }
  return null;
}

// Keyword search is relevance-ranked, not exhaustive: read the top pages per keyword and say so.
export async function readWorkdayBoard(source, fetchImpl = fetch, { keywords = ['intern', 'co-op', 'student'], pages = 5 } = {}) {
  const result = { ...source, status: 'complete', raw: 0, malformed: 0, pages: 0, jobs: [], error: null };
  const seen = new Set();
  try {
    let facets = {};
    for (const searchText of keywords) {
      for (let page = 0; page < pages; page++) {
        const { api, data } = await workdayPage(source, { appliedFacets: facets, limit: 20, offset: page * 20, searchText }, fetchImpl);
        if (page === 0 && !Object.keys(facets).length) {
          const canada = canadaFacet(data.facets);
          if (canada) {
            facets = canada;
            page = -1; // restart this keyword inside Canada only
            continue;
          }
        }
        result.pages++;
        result.raw += data.jobPostings.length;
        for (const item of data.jobPostings) {
          try {
            if (typeof item.title !== 'string' || !item.title.trim() || typeof item.externalPath !== 'string' || !/^\/job\//.test(item.externalPath))
              throw new Error('无效职位');
            const { url } = workdayUrl(source.base + item.externalPath);
            if (seen.has(url)) continue;
            seen.add(url);
            const listed = typeof item.locationsText === 'string' ? item.locationsText : '';
            result.jobs.push({
              company: source.name,
              title: item.title.trim(),
              url,
              jd: '',
              // "2 Locations" hides the cities; inside the Canada facet the country is still known.
              location: Object.keys(facets).length && (!listed || /^\d+ Locations?$/i.test(listed)) ? `${listed || 'Locations'} · Canada` : listed || 'Unknown',
              requisitionId: Array.isArray(item.bulletFields) && typeof item.bulletFields[0] === 'string' ? item.bulletFields[0] : '',
              postedAt: null,
              workMode: 'unknown',
              salary: '未披露',
              sourceEvidence: {
                url: api,
                retrievedAt: new Date().toISOString(),
                listedPosted: typeof item.postedOn === 'string' ? item.postedOn : null,
                note: 'Workday 公开招聘列表；“Posted Today”等相对时间只作提示，发布日期以详情页为准。'
              },
              discoverySources: [{ id: source.id, name: source.name, url: source.url }],
              sourceLinks: [url]
            });
          } catch {
            result.malformed++;
          }
        }
        if (data.jobPostings.length < 20) break;
      }
    }
  } catch (error) {
    result.status = result.pages ? 'partial' : 'failed';
    result.error = error.message;
  }
  return result;
}

const lastRead = new Map();
// One composite source: every learned board, a few at a time, each re-read at most every `maxAgeMs`.
export async function readEmployerBoards(registry, fetchImpl = fetch, { concurrency = 6, maxAgeMs = 6 * 3600000, now = Date.now(), cache = lastRead } = {}) {
  const totals = { status: 'complete', raw: 0, pages: 0, jobs: [], boards: registry.length, failed: 0, reused: 0, error: null };
  let cursor = 0;
  // One employer can expose the same Workday posting on several sites (e.g. External and Campus).
  const seen = new Set();
  const identity = job => {
    const m = job.url.match(/^https:\/\/([^.]+)\.wd\d+\.myworkdayjobs\.com\/(?:[a-z]{2}-[a-z]{2}\/)?[^/]+(\/job\/.+)$/i);
    return m ? `workday:${m[1]}${m[2]}`.toLowerCase() : job.url;
  };
  async function worker() {
    while (cursor < registry.length) {
      const source = registry[cursor++];
      const prior = cache.get(source.id);
      let result;
      if (prior && now - prior.at < maxAgeMs) {
        result = prior.result;
        totals.reused++;
      } else {
        result =
          source.type === 'workday'
            ? await readWorkdayBoard(source, fetchImpl)
            : await readEmployerBoard({ id: source.id, name: source.name, type: source.type, board: source.board, url: source.url }, fetchImpl);
        if (result.status !== 'failed') cache.set(source.id, { at: now, result });
      }
      if (result.status === 'failed') totals.failed++;
      totals.raw += result.raw || 0;
      totals.pages += result.pages || 0;
      for (const job of result.jobs || []) {
        const key = identity(job);
        if (seen.has(key)) continue;
        seen.add(key);
        totals.jobs.push(job);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, registry.length) }, worker));
  if (!registry.length) {
    totals.status = 'failed';
    totals.error = '公共索引不可用，未能整理雇主招聘板名单';
  } else if (totals.failed) {
    totals.status = totals.failed === registry.length ? 'failed' : 'partial';
    totals.error = `${totals.failed} / ${registry.length} 个招聘板暂时不可读`;
  }
  return totals;
}
