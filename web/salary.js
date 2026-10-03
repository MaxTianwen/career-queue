// Display-only interpretation: never convert currencies, annualize or alter eligibility.
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const amount = '(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d{1,2})?[kK]?';
const money = '(?:(?:CAD|USD|EUR|GBP)\\s*\\$?|(?:CA|US|C)?\\$|€|£)';
const expression = new RegExp(`(${money})\\s*(${amount})(?:\\s*(?:[-–—]|to)\\s*(${money})?\\s*(${amount}))?(?![\\d,.])`, 'gi');
const currencyOf = value => /CAD|CA\$|C\$/i.test(value) ? 'CAD' : /USD|US\$/i.test(value) ? 'USD' : /EUR|€/i.test(value) ? 'EUR' : /GBP|£/i.test(value) ? 'GBP' : null;
const numberOf = value => Number(value.replace(/,/g, '').replace(/[kK]$/, '')) * (/[kK]$/.test(value) ? 1000 : 1);
const periods = [['hour', /\b(?:hourly|per hour|per hr|an? hour|hr|hour)\b/i], ['year', /\b(?:annual(?:ly)?|yearly|per year|per annum|an? year|year)\b/i], ['month', /\b(?:monthly|per month|month)\b/i], ['week', /\b(?:weekly|per week|week)\b/i]];
const periodLabel = { hour: '小时', year: '年', month: '月', week: '周' };

export function salaryFacts(job) {
  const raw = String(job.salary || '').trim();
  const field = job.fieldEvidence?.salary;
  const base = { raw, source: field?.source || '已保存薪资字段', min: null, max: null, currency: null, period: null };
  if (field?.status === 'ambiguous') return { ...base, raw: field.raw || raw, status: 'ambiguous', note: '来源存在多个薪资表述，请按适用地区核对。' };
  if (!raw || /^(?:未披露|unknown|not disclosed|TBD|N\/A)$/i.test(raw)) return { ...base, status: 'unknown', note: '未取得确定薪资，不等于无薪。' };
  const hits = [...raw.matchAll(expression)];
  if (hits.length > 1 || /\b(?:bonus|stipend|allowance|equity|stock)\b/i.test(raw)) return { ...base, status: 'ambiguous', note: '包含多项金额或其他报酬，请核对薪资原文。' };
  const hit = hits[0];
  if (!hit) return { ...base, status: 'unknown', note: '保留原文，金额格式尚无法确定。' };
  const min = numberOf(hit[2]), max = hit[4] ? numberOf(hit[4]) : min;
  const currencies = [...new Set([currencyOf(hit[1]), currencyOf(hit[3] || ''), ...[...raw.matchAll(/\b(?:CAD|USD|EUR|GBP)\b/gi)].map(m => m[0].toUpperCase())].filter(Boolean))];
  const units = periods.filter(([, pattern]) => pattern.test(raw)).map(([unit]) => unit);
  if (max < min || currencies.length > 1 || units.length > 1 || /\b(?:up to|starting|from|minimum|maximum|over|under)\b|\+/i.test(raw)
    || hit[4] && /[kK]$/.test(hit[2]) !== /[kK]$/.test(hit[4])
    || /(?:per|\/)\s*(?!1\b)\d+\s*(?:hour|week|month|year)/i.test(raw)) return { ...base, status: 'ambiguous', note: '范围、币种或计薪周期需核实，未合并或换算。' };
  return { ...base, status: 'parsed', min, max, currency: currencies[0] || null, period: units[0] || null };
}

export function salaryText(job) {
  const fact = salaryFacts(job);
  if (fact.status !== 'parsed') return fact.status === 'ambiguous' ? '薪资待核实 · 查看原文' : fact.raw || '未披露';
  const format = n => n.toLocaleString('en-CA', { maximumFractionDigits: 2 });
  return `${fact.currency || '币种待核实'} ${format(fact.min)}${fact.max !== fact.min ? '–' + format(fact.max) : ''} / ${periodLabel[fact.period] || '周期待核实'}`;
}

export function salaryDetails(job) {
  const fact = salaryFacts(job);
  return `<details class="salary-evidence"><summary>薪资原文与口径${fact.status !== 'parsed' || !fact.currency || !fact.period ? ' · 待核实' : ''}</summary><p>${esc(salaryText(job))}</p><blockquote>${esc(fact.raw || '未取得薪资原文')}</blockquote><p class="assessment-note">依据：${esc(fact.source)}。${esc(fact.note || '仅拆分原文，不估算或换算；裸 $ 不推断为加元。')}</p></details>`;
}
