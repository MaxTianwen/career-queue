import { seasonForMonth } from '../../src/internship-options.mjs';
import { startTerms } from '../../src/start-terms.mjs';
import { publicationFacts, publicationLabel } from '../../src/publication-facts.mjs';
import { deadlineExpired } from '../../src/deadlines.mjs';
import { jobCategory } from '../../src/job-category.mjs';
import { jobCountries, countryFilterFacts, remoteFacts, usRemoteEligibility } from '../../src/job-country.mjs';
import { durationFacts } from '../../src/duration-facts.mjs';
import { classifyResume } from '../../src/resume-track.mjs';
// Display and filtering only. Unknown facts stay unknown; never alter eligibility or records.
export function platform(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return { name: '学校 / 手动入口', questions: false };
  }
  const h = u.hostname.toLowerCase();
  const questions =
    u.protocol === 'https:' &&
    !u.port &&
    !u.username &&
    !u.password &&
    ['boards.greenhouse.io', 'job-boards.greenhouse.io'].includes(h) &&
    /^\/[\w-]+\/jobs\/\d+\/?$/.test(u.pathname);
  return {
    name: ['boards.greenhouse.io', 'job-boards.greenhouse.io'].includes(h)
      ? 'Greenhouse'
      : h === 'jobs.ashbyhq.com'
        ? 'Ashby'
        : h === 'jobs.lever.co'
          ? 'Lever'
          : h.endsWith('.myworkdayjobs.com')
            ? 'Workday'
            : '公司官网',
    questions
  };
}
// Preserve season/year pairs from the strongest term source; never borrow a year across alternatives.
export function termPairs(job) {
  return startTerms(job);
}
const termLabels = f =>
  f.terms.length
    ? f.terms
        .map(
          p => `${p.season ? p.season[0].toUpperCase() + p.season.slice(1) : '学期未知'} ${p.year || '（年份待确认）'}`
        )
        .join(' / ')
    : '开始学期／年份未知';
export function opportunityFacts(job) {
  const terms = startTerms(job);
  let seasons = [...new Set(terms.map(p => p.season).filter(Boolean))];
  const durationInfo = durationFacts(job),
    durations = durationInfo.options.map(n => ({ min: n, max: n })),
    durationIssues = [
      ...durationInfo.review,
      ...durationInfo.intervals.map(r => r.raw),
      ...durationInfo.ranges.map(r => r.raw),
      ...durationInfo.other.map(r => r.raw)
    ];
  if (durationInfo.placements.length) seasons = [...new Set(durationInfo.placements.map(p => p.season))];
  const track = job.classification?.track || classifyResume(job).track;
  const category = job.resumeSelection
    ? {
        primary: job.resumeSelection.classification.category,
        label: job.resumeSelection.classification.label,
        evidence: Object.values(job.resumeSelection.classification.evidence).flat()
      }
    : jobCategory(job);
  return {
    terms,
    seasons,
    durations,
    durationIssues,
    durationInfo,
    track,
    category,
    platform:
      job.hasSchool && !job.hasPublic
        ? job.externalUrl
          ? platform(job.externalUrl)
          : { name: '学校 Portal', questions: false }
        : platform(job.url)
  };
}
export function normalizeCountry(value) {
  return value === 'CA-US' ? 'all' : ['CA', 'US', 'all'].includes(value) ? value : 'CA';
}
// Reuse country evidence only within this call; never retain account data or time-sensitive results.
function matchesCountry(job, country, facts = countryFilterFacts(job)) {
  return country === 'US'
    ? facts.usEmployerRemote || usRemoteEligibility(job).eligible
    : facts.countries.includes(country);
}
export function matchesOpportunity(job, filters = {}) {
  if (['24h', '2d'].includes(filters.publication)) {
    const p = publicationFacts(
      { ...job, sourceEvidence: job.publicationEvidence || job.sourceEvidence },
      filters.now ?? Date.now()
    );
    // '2d' also admits date-only sources (Workday) whose Toronto date is today or yesterday.
    if (!(p.recent24h || (filters.publication === '2d' && p.recentDay))) return false;
  }
  const query = String(filters.query || '')
    .trim()
    .toLocaleLowerCase();
  if (
    query &&
    !query
      .split(/\s+/)
      .every(word =>
        [job.company, job.title, job.requisitionId, job.schoolId, ...(job.schoolSources || []).map(s => s.schoolId)]
          .join(' ')
          .toLocaleLowerCase()
          .includes(word)
      )
  )
    return false;
  const unknown = filters.unknown === true;
  const country = filters.country ? normalizeCountry(filters.country) : 'all';
  if (country !== 'all' && !matchesCountry(job, country)) return false;
  if (filters.source === 'school' && !job.hasSchool) return false;
  if (filters.source === 'public' && !job.hasPublic) return false;
  // Country counts and text-only filters do not need term/duration/category parsing.
  const f =
    filters.year || filters.season || filters.months || filters.category || filters.platform
      ? opportunityFacts(job)
      : null;
  const matches = (known, match) => (known ? match : unknown);
  if (filters.year) {
    const relevant = filters.season ? f.terms.filter(p => !p.season || p.season === filters.season) : f.terms;
    if (relevant.length && !relevant.some(p => !p.year || p.year === String(filters.year))) return false;
  }
  if (filters.season && !matches(f.seasons.length, f.seasons.includes(filters.season))) return false;
  if (filters.months) {
    const n = +filters.months,
      placements = f.durationInfo.placements;
    if (placements.length) {
      if (
        !placements.some(
          p =>
            (!filters.season || p.season === filters.season) &&
            (!filters.year || !p.start || p.start.startsWith(String(filters.year))) &&
            n >= p.months.min &&
            n <= p.months.max
        )
      )
        return false;
    } else if (f.durationInfo.windows.length) {
      if (
        !f.durationInfo.windows.some(
          w =>
            w.months === n &&
            w.startOptions.some(
              start =>
                (!filters.year || start.startsWith(String(filters.year))) &&
                (!filters.season || seasonForMonth(Number(start.slice(5, 7))) === filters.season)
            )
        )
      )
        return false;
    } else {
      const lengths = [
        ...f.durations,
        ...f.durationInfo.ranges.filter(r => r.unit === 'months'),
        ...f.durationInfo.other.filter(r => r.unit === 'months').map(r => ({ min: r.value, max: r.value }))
      ];
      if (
        !matches(
          lengths.length,
          lengths.some(d => n >= d.min && n <= d.max)
        )
      )
        return false;
    }
  }
  if (
    filters.category &&
    !matches(
      f.category.primary !== 'unknown',
      f.category.primary === filters.category ||
        (f.category.primary === 'mixed' && ['cs', 'data'].includes(filters.category))
    )
  )
    return false;
  const location = String(filters.location || '')
    .trim()
    .toLocaleLowerCase();
  if (location && !workLocations(job).some(value => value.toLocaleLowerCase().includes(location))) return false;
  if (filters.platform && f.platform.name !== filters.platform) return false;
  return true;
}
// Only explicit workplace fields; never mine JD, company addresses or work-mode hints.
export function workLocations(job = {}) {
  return [
    ...new Set(
      [
        ...(Array.isArray(job.location) ? job.location : [job.location]),
        ...(Array.isArray(job.locations) ? job.locations : [])
      ]
        .filter(v => typeof v === 'string')
        .map(v => v.trim())
        .filter(
          v =>
            v &&
            !/^(?:unknown|未提供|地点未知|待确认)$/i.test(v) &&
            !/^(?:headquarters|head office|company address)\s*:/i.test(v)
        )
    )
  ];
}
export function countryCounts(jobs, filters = {}) {
  const unique = [...new Map(jobs.map(j => [j.id || j, j])).values()].filter(j =>
    matchesOpportunity(j, { ...filters, country: 'all' })
  );
  let caOnly = 0,
    usOnly = 0,
    both = 0,
    other = 0;
  for (const j of unique) {
    const facts = countryFilterFacts(j),
      ca = matchesCountry(j, 'CA', facts),
      us = matchesCountry(j, 'US', facts);
    if (ca && us) both++;
    else if (ca) caOnly++;
    else if (us) usOnly++;
    else other++;
  }
  return { all: unique.length, CA: caOnly + both, US: usOnly + both, caOnly, usOnly, both, other };
}
export function countryCountSummary(jobs, filters = {}) {
  const c = countryCounts(jobs, filters),
    p = document.createElement('p');
  p.className = 'country-count-summary muted';
  p.textContent = `其他条件下：加拿大 ${c.CA} · 美国 ${c.US}${c.both ? ` （其中 ${c.both} 个两边都算）` : ''}${c.other ? ` · 国家待确认 ${c.other}` : ''}`;
  p.title = `共 ${c.all} 个岗位 = 仅加拿大 ${c.caOnly} + 仅美国 ${c.usOnly} + 两组共有 ${c.both} + 其他／待确认 ${c.other}。美国组沿用已确认的全远程规则。`;
  return p;
}
export function placementGroups(placements) {
  const groups = new Map();
  for (const p of placements) {
    const key = p.season + ':' + p.start;
    let group = groups.get(key);
    if (!group) {
      group = { season: p.season, start: p.start, options: [] };
      groups.set(key, group);
    }
    const label =
      (p.months.kind === 'range' ? p.months.min + '–' + p.months.max : p.months.min) +
      ' 个月' +
      (p.end ? '（至 ' + p.end + '）' : '');
    if (!group.options.includes(label)) group.options.push(label);
  }
  return [...groups.values()];
}
export function preparationRoute(job) {
  if (!job) return '';
  if (!job.url) return '尚无官网链接；请按学校或原始申请说明确认入口。';
  return platform(job.url).questions
    ? '可以读取这份申请表的问题，也可以直接准备简历后到官网申请。'
    : '先准备和检查简历，再打开岗位官网申请。需要的问答可记在下方，不需要浏览器配对。';
}

export function factsLabel(job) {
  const f = opportunityFacts(job);
  if (f.durationInfo.placements.length) {
    const labels = f.seasons.map(season => {
      const values = [
        ...new Set(
          f.durationInfo.placements
            .filter(p => p.season === season)
            .map(p =>
              p.months.kind === 'range' ? p.months.min + '–' + p.months.max + '（范围）' : String(p.months.min)
            )
        )
      ];
      return season[0].toUpperCase() + season.slice(1) + ' ' + values.join(' / ') + ' 个月';
    });
    return labels.join(' · ') + ' · ' + f.platform.name;
  }
  return `${termLabels(f)} · ${f.durations.map(d => (d.min === d.max ? d.min : d.min + '–' + d.max)).join(' / ') || f.durationInfo.ranges.map(v => v.min + '–' + v.max + (v.unit === 'weeks' ? ' 周' : ' 个月')).join(' / ') || f.durationInfo.other.map(v => v.value + (v.unit === 'weeks' ? ' 周' : ' 个月')).join(' / ') || f.durationInfo.intervals.map(v => v.start + ' 至 ' + v.end).join(' / ') || '时长未知'}${f.durations.length ? ' 个月' : ''} · ${f.platform.name} · ${!job.url ? '申请入口待核实' : f.platform.questions ? '可读取申请问题' : '准备材料后去官网申请'}`;
}
export function mountFilters(container, onChange, { schoolOnly = false, country = 'CA', publication = true } = {}) {
  container.className = 'opportunity-filters';
  if (publication) {
    const scope = document.createElement('p');
    scope.className = 'muted opportunity-year-scope';
    scope.textContent = '当前机会范围：2027年开始；开始年未知的职位保留，需核实。';
    container.append(scope);
  }
  const search = document.createElement('label');
  search.className = 'filter-search';
  search.textContent = '搜索职位';
  const query = document.createElement('input');
  query.type = 'search';
  query.name = 'query';
  query.placeholder = '职位、公司或编号';
  search.append(query);
  container.append(search);
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'filter-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  container.dataset.collapsed = 'true';
  toggle.addEventListener('click', () => {
    const open = container.dataset.collapsed === 'true';
    container.dataset.collapsed = String(!open);
    toggle.setAttribute('aria-expanded', String(open));
  });
  container.append(toggle);
  const extra = document.createElement('details');
  extra.className = 'filter-extra';
  const title = document.createElement('summary');
  title.textContent = '更多条件';
  extra.append(title);
  for (const [name, label, choices] of [
    ['year', '开始年份', [['', '所有年份'], ...['2026', '2027', '2028', '2029', '2030'].map(y => [y, y])]],
    [
      'publication',
      '发布时间',
      [
        ['', '所有发布时间'],
        ['24h', '最近 24 小时（精确时间）'],
        ['2d', '今天或昨天发布（含仅有日期的来源）']
      ]
    ],
    [
      'category',
      '职位类别',
      [
        ['', '所有类别'],
        ['cs', 'CS / Software'],
        ['embedded', 'Firmware / Embedded'],
        ['hardware', '硬件 / 芯片'],
        ['data', '数据 / 分析'],
        ['business', '商业 / 产品分析']
      ]
    ],
    [
      'season',
      '开始学期',
      [
        ['', '所有学期'],
        ['winter', 'Winter'],
        ['summer', 'Summer'],
        ['fall', 'Fall']
      ]
    ],
    ['months', '时长（月）', [['', '所有时长'], ...[3, 4, 8, 12, 16].map(n => [String(n), n + ' 个月'])]],
    [
      'country',
      '国家筛选',
      [
        ['CA', '加拿大'],
        ['US', '美国'],
        ['all', '全部']
      ]
    ],
    [
      'source',
      '职位来源',
      [
        ['', '全部来源'],
        ['school', '学校职位'],
        ['public', '网络发现']
      ]
    ],
    [
      'platform',
      '申请方式',
      [
        ['', '所有平台'],
        ['Greenhouse', 'Greenhouse'],
        ['Ashby', 'Ashby'],
        ['Lever', 'Lever'],
        ['Workday', 'Workday'],
        ['公司官网', '公司官网'],
        ['学校 Portal', '学校 Portal']
      ]
    ]
  ]) {
    if (
      (schoolOnly && name === 'source') ||
      (!publication && name === 'publication') ||
      (publication && name === 'year')
    )
      continue;
    const l = document.createElement('label');
    l.textContent = label;
    const select = document.createElement('select');
    select.name = name;
    for (const [v, t] of choices) select.add(new Option(t, v));
    if (name === 'year') {
      select.value = publication ? '2027' : '';
      select.dataset.defaultValue = select.value;
    }
    if (name === 'country') {
      select.value = normalizeCountry(country);
      select.title = '美国公司的全远程岗位归美国；现场或混合岗位按实际工作地点。未知公司国家不由Remote推断。';
    }
    l.append(select);
    (['source', 'platform'].includes(name) ? extra : container).append(l);
  }
  const l = document.createElement('label');
  l.textContent = '城市 / 地点';
  const input = document.createElement('input');
  input.name = 'location';
  input.placeholder = '如 Toronto、Montreal、Remote';
  input.title = '按工作地点里的关键词匹配，不区分大小写；不扩展城市范围，地点未知的职位不匹配。';
  l.append(input);
  container.append(l);
  const u = document.createElement('label');
  u.className = 'check';
  const c = document.createElement('input');
  c.type = 'checkbox';
  c.name = 'unknown';
  u.append(c, '同时保留相关条件未知的职位');
  extra.append(u);
  container.append(extra);
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'filter-reset';
  let active = 0;
  const syncReset = () => {
    active = [...container.querySelectorAll('input,select')].filter(e =>
      e.type === 'checkbox'
        ? e.checked
        : e.name === 'country'
          ? normalizeCountry(e.value) !== 'all'
          : Boolean(e.value.trim())
    ).length;
    reset.textContent = active ? '清空筛选（' + active + '）' : '无筛选条件';
    const names = [...container.querySelectorAll('input,select')]
      .filter(e =>
        e.type === 'checkbox'
          ? e.checked
          : e.name === 'country'
            ? normalizeCountry(e.value) !== 'all'
            : Boolean(e.value.trim())
      )
      .map(
        e =>
          (e.type === 'checkbox'
            ? e.closest?.('label')?.textContent?.trim()
            : e.closest?.('label')?.firstChild?.textContent?.trim()) || e.name
      );
    reset.title = names.length ? '当前条件：' + names.join('、') : '';
    toggle.textContent = active ? '筛选条件（' + active + '）' : '筛选条件';
    reset.setAttribute('aria-disabled', String(active === 0));
    reset.dataset.active = String(active > 0);
  };
  const notify = () => {
    syncReset();
    onChange();
  };
  reset.addEventListener('click', () => {
    if (!active) return;
    for (const e of container.querySelectorAll('input,select')) {
      if (e.type === 'checkbox') e.checked = false;
      else e.value = e.name === 'country' ? 'all' : '';
    }
    notify();
  });
  container.append(reset);
  syncReset();
  container.addEventListener('input', event => {
    if (event.target.tagName !== 'SELECT') notify();
  });
  container.addEventListener('change', notify);
  return () => {
    syncReset();
    const values = Object.fromEntries(
      [...container.querySelectorAll('input,select')].map(e => {
        if (e.name === 'country') e.value = normalizeCountry(e.value);
        return [e.name, e.type === 'checkbox' ? e.checked : e.value];
      })
    );
    if (publication) values.year = '2027';
    return values;
  };
}

// Fixed semantic tokens shared by discovery, school, cards and tables.
export const factPalette = Object.freeze({
  'season-summer': { label: 'Summer', foreground: '#854500', background: '#fff2cf' },
  'season-fall': { label: 'Fall', foreground: '#93351b', background: '#ffeadf' },
  'season-winter': { label: 'Winter', foreground: '#18558c', background: '#e5f2ff' },
  'months-4': { label: '4 个月', foreground: '#006355', background: '#dcf6ef' },
  'months-8': { label: '8 个月', foreground: '#35499c', background: '#eaf0ff' },
  'months-12': { label: '12 个月', foreground: '#952e59', background: '#ffe7f0' },
  'months-16': { label: '16 个月', foreground: '#683899', background: '#f1e7ff' },
  unknown: { label: '待确认', foreground: '#525967', background: '#eef0f3' }
});
export function factBadges(job) {
  const facts = opportunityFacts(job),
    box = document.createElement('div');
  box.className = 'fact-badges';
  if (job.hasSchool) {
    const badge = document.createElement('span');
    badge.className = 'badge school-source';
    badge.textContent = job.hasPublic ? '学校 + 网络' : '学校职位';
    box.append(badge);
  }
  const token = (key, label) => {
    const badge = document.createElement('span');
    badge.className = 'badge fact-token fact-' + key;
    badge.textContent = label || factPalette[key].label;
    box.append(badge);
  };
  if (facts.terms.length) {
    for (const p of facts.terms)
      token(
        p.season ? 'season-' + p.season : 'unknown',
        `${p.season ? p.season[0].toUpperCase() + p.season.slice(1) : '学期未知'} ${p.year || '（年份待确认）'}`
      );
  } else token('unknown', '学期／年份未知');
  if (!facts.durationInfo.placements.length && facts.durations.length)
    for (const duration of facts.durations) token('months-' + duration.min);
  for (const range of facts.durationInfo.placements.length ? [] : facts.durationInfo.ranges)
    token('unknown', `${range.min}–${range.max} ${range.unit === 'weeks' ? '周' : '个月'}`);
  for (const item of facts.durationInfo.placements.length ? [] : facts.durationInfo.other)
    token('unknown', `${item.value} ${item.unit === 'weeks' ? '周' : '个月'}`);
  for (const item of facts.durationInfo.intervals) token('unknown', `${item.start} 至 ${item.end}`);
  if (
    !facts.durations.length &&
    !facts.durationInfo.ranges.length &&
    !facts.durationInfo.other.length &&
    !facts.durationInfo.intervals.length
  )
    token('unknown', '时长未知');
  if (facts.durationInfo.placements.length) {
    const choices = document.createElement('div');
    choices.className = 'placement-options';
    for (const p of placementGroups(facts.durationInfo.placements)) {
      const line = document.createElement('p');
      line.textContent = `${p.season[0].toUpperCase() + p.season.slice(1)} · ${p.start} 起 · ${p.options.join(' / ')}`;
      choices.append(line);
    }
    box.append(choices);
  }
  if (job.eligibilityReview) token('unknown', '资格待核实');
  const countryFacts = countryFilterFacts(job),
    countries = countryFacts.workplaceCountries,
    remote = remoteFacts(job);
  const country = document.createElement('span');
  country.className = 'badge country-badge';
  country.textContent = countries.map(c => (c === 'CA' ? '加拿大' : '美国')).join(' / ') || '工作地点国家待核实';
  box.append(country);
  if (countryFacts.employer) {
    const companyCountry = document.createElement('span');
    companyCountry.className = 'badge employer-country';
    companyCountry.textContent = '公司国家：' + (countryFacts.employer.country === 'US' ? '美国' : '加拿大');
    companyCountry.title = countryFacts.employer.basis + ' · ' + countryFacts.employer.sourceUrl;
    box.append(companyCountry);
  }
  if (countryFacts.usEmployerRemote) {
    const assignment = document.createElement('p');
    assignment.className = 'country-restrictions';
    assignment.textContent = '筛选归类：美国（美国公司的全远程岗位）；工作地点按官网原文保留。';
    box.append(assignment);
  }
  if (countries.includes('US')) {
    const warning = document.createElement('div');
    warning.className = 'country-restrictions';
    warning.textContent =
      (/2027/.test(job.title || '') && /\b(?:Summer|Winter|Fall) 2026\b/i.test(job.jd || '')
        ? '标题与正文年份不一致，学期需核实。 '
        : '') +
      (remote.fullyRemote ? '全远程 · ' : '') +
      (countries.includes('CA') ? '官网列出加拿大和美国工作地点；并非公司国家。' : '美国岗位：不代表可从加拿大工作。') +
      (remote.restrictions.length ? ' ' + remote.restrictions.join(' ') : ' 居住及工作授权要求待核实。');
    box.append(warning);
  }
  const category = document.createElement('span');
  category.className = 'badge category-badge';
  category.textContent = facts.category.label;
  box.append(category);
  const platform = document.createElement('span');
  platform.className = 'badge';
  platform.textContent = facts.platform.name;
  box.append(platform);
  return box;
}

// Presentation only: preserve source precision and keep channel deadlines independent.
export function deadlineEntries(job, now = new Date()) {
  const entries = [],
    schools = job.schoolSources || [];
  const add = (label, raw, value, school = false) => {
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value || ''),
      instant = /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value || '') && Number.isFinite(Date.parse(value));
    const assumed =
      school && instant && raw !== value && !/(?:Z|[+-]\d{2}:\d{2}|\b(?:EST|EDT|UTC|GMT)\b)$/i.test(raw || '');
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Toronto',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(now);
    const expired = deadlineExpired(value, now),
      soon = instant && Date.parse(value) - now <= 48 * 3600000 && Date.parse(value) - now >= 0;
    const status = expired ? '已截止' : dateOnly && value === today ? '今日截止' : soon ? '48 小时内截止' : '';
    entries.push({
      label,
      value: raw || value || '未提供',
      known: !!(raw || value),
      status,
      tone: expired ? 'expired' : status ? 'soon' : 'neutral',
      note: assumed
        ? '原文未标时区；按 Toronto 解释'
        : dateOnly
          ? '仅日期'
          : raw && !instant && !dateOnly
            ? '时间 / 时区待核实'
            : '',
      title: assumed ? '解析时间：' + value : ''
    });
  };
  if (job.hasPublic) add('官网截止', job.deadline, job.deadline);
  for (const source of schools)
    add(
      '学校截止' + (schools.length > 1 ? '（' + source.schoolId + '）' : ''),
      source.row?.deadlineText || source.row?.deadline,
      source.row?.deadline,
      true
    );
  for (const source of schools)
    if (/^(?:closed|expired|position closed|job closed)$/i.test(source.row?.sourceStatus?.trim() || ''))
      entries.push({
        label: '学校状态（' + source.schoolId + '）',
        value: '已关闭（学校来源）',
        known: true,
        status: '',
        tone: 'expired',
        note: ''
      });
  return entries;
}

export function deadlineSummary(job, now = new Date()) {
  const box = document.createElement('div');
  box.className = 'card-deadline';
  const entries = deadlineEntries(job, now);
  if (!entries.length) {
    box.textContent = '截止日期未提供';
    return box;
  }
  for (const entry of entries) {
    const line = document.createElement('p');
    line.className = 'deadline-line deadline-' + entry.tone + (entry.known ? '' : ' deadline-unknown');
    const label = document.createElement('span');
    label.className = 'deadline-label';
    label.textContent = entry.label + '：';
    const value = document.createElement(entry.known ? 'strong' : 'span');
    value.textContent = entry.value + (entry.status ? '（' + entry.status + '）' : '');
    value.title = entry.title || '';
    line.append(label, value);
    if (entry.note) {
      const note = document.createElement('small');
      note.textContent = entry.note;
      line.append(note);
    }
    box.append(line);
  }
  return box;
}

export function publicationSummary(job, { detailed = false } = {}) {
  const p = document.createElement('p');
  p.className = 'card-publication';
  const value = { ...job, sourceEvidence: job.publicationEvidence || job.sourceEvidence },
    facts = publicationFacts(value);
  const full = publicationLabel(value),
    label = facts.kind === 'latest' ? '最近发布（可能重发）' : facts.kind === 'first' ? '首次发布' : '官方发布';
  const day =
    facts.precision === 'instant'
      ? new Intl.DateTimeFormat('en-CA', {
          timeZone: 'America/Toronto',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).format(new Date(facts.instant))
      : facts.raw;
  p.textContent = detailed
    ? full
    : facts.precision === 'unknown'
      ? '发布时间未知'
      : facts.precision === 'unresolved'
        ? '发布时间待核实'
        : label +
          '：' +
          day +
          (facts.precision === 'date' ? '（仅日期）' : '') +
          (facts.future ? '（未来时间，待核实）' : '');
  p.title = [full, facts.sourceField, facts.sourceUrl, facts.raw].filter(Boolean).join(' · ');
  return p;
}

export function freshnessSummary(job, now = Date.now()) {
  const p = document.createElement('p');
  p.className = 'card-freshness muted';
  const format = value =>
    value && Number.isFinite(Date.parse(value))
      ? new Intl.DateTimeFormat('zh-CN', {
          timeZone: 'America/Toronto',
          dateStyle: 'short',
          timeStyle: 'short'
        }).format(new Date(value)) + ' Toronto'
      : '未知';
  const checked = job.sourceEvidence?.retrievedAt,
    listed = job.publicUpdated || job.sourceUpdatedAt;
  const parts = [`列表检查：${format(listed)}`, `正文核验：${format(checked)}`];
  if (job.detailRateLimit) {
    const until = job.detailRateLimit.nextRetryAt;
    parts.push(
      `来源限流（429）；${until > now ? '最早 ' + format(new Date(until).toISOString()) + ' 后' : '冷却已结束，下一次'}由用户刷新时重试，不自动请求`
    );
  } else if (job.detailAccessDenied) parts.push('来源拒绝访问，已停止自动重试');
  if (job.detailError) parts.push(`原因：${job.detailError}`);
  if (job.stale || (job.detailError && job.jd)) parts.push('当前显示上次正文，尚未重新核验');
  else if (!job.jd) parts.push('尚无完整正文');
  p.textContent = parts.join(' · ');
  return p;
}

// One badge per opportunity; discovery novelty is independent of official publication.
export function discoveryPriority(job, now = Date.now()) {
  const first = Date.parse(job.firstSeenAt),
    age = Number(now) - first;
  if (job.hasPublic && Number.isFinite(first) && age >= 0 && age < 86400000)
    return {
      rank: 0,
      label: '新发现',
      kind: 'new',
      note: '首次发现至今未满24小时；不代表刚刚发布，重复刷新不会延长。'
    };
  const published = publicationFacts({ ...job, sourceEvidence: job.publicationEvidence || job.sourceEvidence }, now);
  if (published.recent24h)
    return { rank: 1, label: '近24小时发布', kind: 'recent', note: '来源明确的发布时间在过去24小时内。' };
  if (published.recentDay)
    return { rank: 1, label: '今天或昨天发布', kind: 'recent', note: '来源只给发布日期、没有具体时间；按多伦多日期为今天或昨天。' };
  return { rank: 2, label: '', kind: 'other', note: '' };
}
export function orderDiscovery(jobs, now = Date.now()) {
  // Date-only sources retain day precision: compare calendar days, then exact instants
  // within a day when both are known. Never turn a date into an invented midnight.
  const key = job => {
    const p = publicationFacts({ ...job, sourceEvidence: job.publicationEvidence || job.sourceEvidence }, now);
    return {
      p,
      day:
        p.precision === 'instant' ? new Date(p.instant).toISOString().slice(0, 10) : p.precision === 'date' ? p.raw : ''
    };
  };
  const stable = j => String(j.id || j.url || [j.company, j.title, j.location].join('|'));
  return jobs
    .map(job => ({ job, ...key(job) }))
    .sort(
      (a, b) =>
        b.day.localeCompare(a.day) ||
        (a.p.precision === 'instant' ? 0 : 1) - (b.p.precision === 'instant' ? 0 : 1) ||
        (a.p.precision === 'instant' && b.p.precision === 'instant' ? b.p.instant - a.p.instant : 0) ||
        stable(a.job).localeCompare(stable(b.job))
    )
    .map(x => x.job);
}
export function discoveryBadge(job, now = Date.now()) {
  const info = discoveryPriority(job, now),
    published = publicationFacts({ ...job, sourceEvidence: job.publicationEvidence || job.sourceEvidence }, now),
    recent = published.recent24h ? ' · 近24小时发布' : published.recentDay ? ' · 今天或昨天发布' : '';
  if (!info.label) return null;
  const badge = document.createElement('strong');
  badge.className = 'discovery-priority priority-' + info.kind;
  badge.textContent = info.label + (info.kind === 'new' ? recent : '');
  badge.title = info.note;
  return badge;
}

// Visual normalization only; the stored match score and ordering are untouched.
export function displayScore(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : null;
}
// needsResume: no usable resume was resolved, so the score can only appear after one is set in 我的文件.
export function scoreRing(value, { reason = '', needsResume = false } = {}) {
  const score = displayScore(value),
    wrap = document.createElement('div'),
    ring = document.createElement('span'),
    label = document.createElement('span');
  wrap.className = 'match-score';
  ring.className = 'score-ring';
  ring.dataset.level = score === null ? 'unknown' : score >= 75 ? 'high' : score >= 40 ? 'medium' : 'low';
  ring.style.setProperty('--score', score ?? 0);
  ring.textContent = score === null ? '—' : String(score);
  ring.setAttribute('role', 'img');
  ring.setAttribute(
    'aria-label',
    score === null
      ? needsResume
        ? '匹配分未知，需先在我的文件设置简历'
        : '匹配分未知，暂不评分'
      : `匹配分 ${score} / 100`
  );
  label.className = 'score-label';
  label.textContent = score === null ? (needsResume ? '需设置简历' : '暂不评分') : '匹配分';
  label.setAttribute('aria-hidden', 'true');
  if (score === null && reason) wrap.title = reason;
  wrap.append(ring, label);
  return wrap;
}
