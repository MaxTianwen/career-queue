import { officialJob } from './discovery.mjs';
import { deadlineExpired, extractDeadline } from './deadlines.mjs';
import { workdayUrl } from './workday.mjs';
import { pinpointUrl } from './discovery-sources.mjs';

// An allowlist for the existing public readers, never a general URL fetcher.
function source(value) {
  const pinpoint = pinpointUrl(value);
  if (pinpoint) return { url: pinpoint, allowed: new Set([pinpoint]) };
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.port || u.username || u.password) return null;
  let match;
  if (/^[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com$/.test(u.hostname)) {
    const { url } = workdayUrl(value);
    return { url, allowed: new Set([url]) };
  }
  if (['boards.greenhouse.io', 'job-boards.greenhouse.io'].includes(u.hostname) &&
      (match = u.pathname.match(/^\/([a-z0-9_-]+)\/jobs\/(\d+)\/?$/i))) {
    const [, board, id] = match;
    const url = `https://job-boards.greenhouse.io/${board}/jobs/${id}`;
    return { url, allowed: new Set([url, `https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${id}`]) };
  }
  if (['jobs.lever.co', 'jobs.ashbyhq.com'].includes(u.hostname) &&
      (match = u.pathname.match(/^\/([^/]+)\/([a-f0-9-]{36})(?:\/(?:application|apply))?\/?$/i))) {
    const board = decodeURIComponent(match[1]), id = match[2];
    if (!/^[a-z0-9 ._-]{1,100}$/i.test(board)) return null;
    const url = `https://${u.hostname}/${encodeURIComponent(board)}/${id}`;
    const api = u.hostname === 'jobs.lever.co'
      ? `https://api.lever.co/v0/postings/${encodeURIComponent(board)}/${id}?mode=json`
      : `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}?includeCompensation=true`;
    return { url, allowed: new Set([url, api]) };
  }
  return null;
}

function closedHeading(html) {
  // Only an explicit page heading, not a substring in a JD, script or blog prose.
  const page = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  for (const match of page.matchAll(/<h[12]\b([^>]*)>([\s\S]*?)<\/h[12]>/gi)) {
    if (/\bhidden\b|\baria-hidden\s*=\s*["']?true\b|\b(?:display\s*:\s*none|visibility\s*:\s*hidden)\b/i.test(match[1])) continue;
    const text = match[2].replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim().replace(/\s+/g, ' ');
    if (/^(?:sorry[,!]?\s+)?(?:this (?:job|position) (?:is no longer (?:available|open)|has been (?:closed|filled))|the job you are looking for is no longer (?:available|open)|applications for this (?:job|position) are (?:now )?closed)[.!]?$/i.test(text)) return text;
  }
  return null;
}

/** Read-only recheck. HTTP failures and missing/unlisted jobs are not closure proof. */
export async function checkAvailability(job, { fetchImpl = fetch, now = new Date() } = {}) {
  const checkedAt = now.toISOString();
  const result = (status, evidence, sourceUrl = job.url || '', fresh) => ({
    status, checkedAt, evidence, sourceUrl, ...(fresh ? { job: fresh } : {})
  });
  if (deadlineExpired(job.deadline, now)) return result('closed', `已记录的申请截止时间已过：${job.deadline}`);
  let target;
  try { target = source(job.url); } catch { /* Invalid URLs remain unverified. */ }
  if (!target) return result('unknown', '此链接尚无受支持的官方岗位读取器；请打开官网核实');

  const pages = new Map();
  const guardedFetch = async (url, options = {}) => {
    if (!target.allowed.has(String(url))) throw new Error('读取器请求了不匹配的来源');
    const response = await fetchImpl(url, { ...options, redirect: 'manual',
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
    if (response.redirected || response.status >= 300 && response.status < 400 || response.url && response.url !== String(url)) throw new Error('官方页面发生跳转，未跟随');
    if (!response.ok) throw new Error(`官方来源 HTTP ${response.status}`);
    const isPage = String(url) === target.url;
    const limit = isPage ? 2_000_000 : 25_000_000;
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > limit) throw new Error('官方来源响应超过大小限制');
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);
    if (isPage) pages.set(target.url, body.toString('utf8'));
    return new Response(body, { status: response.status, headers: response.headers });
  };

  let fresh, failure;
  try {
    // A saved deadline must not masquerade as newly fetched official metadata.
    fresh = await officialJob({ ...job, url: target.url, deadline: null, deadlineEvidence: null }, guardedFetch);
    if (fresh) fresh = { ...job, ...fresh, ...extractDeadline(fresh) };
  } catch (error) { failure = error; }

  // A missing API record alone is inconclusive; an explicit official page notice can resolve it.
  if (!fresh && !pages.has(target.url) && !/timeout|abort|超时|跳转|HTTP (?:403|429|5\d\d)/i.test(failure?.message || '')) {
    try { await guardedFetch(target.url, { headers: { Accept: 'text/html' } }); }
    catch (error) { failure = error; }
  }
  const closure = closedHeading(pages.get(target.url) || '');
  if (fresh && deadlineExpired(fresh.deadline, now)) return result('closed', `官方申请截止时间已过：${fresh.deadline}`, target.url, fresh);
  if (closure && fresh) return result('unknown', `官方页面同时存在岗位数据与关闭提示，需本人核实：${closure}`, target.url);
  if (closure) return result('closed', `官方岗位页面明确提示：${closure}`, target.url);
  if (fresh && String(fresh.jd || '').trim().length >= 80) return result('open', '官方来源仍提供与岗位编号相符的完整职位内容', fresh.sourceEvidence?.url || target.url, fresh);
  if (fresh) return result('unknown', '官方正文过短，无法确认岗位是否仍开放', target.url);
  return result('unknown', `暂无法确认岗位开放状态：${String(failure?.message || '未取得可核对的官方岗位内容').slice(0, 240)}`, target.url);
}
