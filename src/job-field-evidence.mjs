// Conservative, source-backed extraction. Absence is not proof of nondisclosure.
export function enrichFields(job) {
  const evidence = { ...job.fieldEvidence }, body = job.jd || '';
  let salary = job.salary || '未披露';
  if (salary === '未披露') {
    const amounts = [...body.matchAll(/(?:\b(?:CAD|USD|GBP|EUR)\s*|(?:CA|US)?\$)\s*\d[\d,.]*(?:[kK])?(?:\s*(?:-|–|to)\s*(?:(?:CAD|USD|GBP|EUR)\s*|(?:CA|US)?\$)?\s*\d[\d,.]*(?:[kK])?)?\s*(?:CAD|USD)?\s*(?:per\s+|\/|an?\s+)(?:hour|hr|year|annum|month|week)\b/gi)].filter(m => {
      const start = Math.max(body.lastIndexOf('\n', m.index), body.lastIndexOf('. ', m.index)) + 1;
      const end = body.indexOf('\n', m.index);
      const line = body.slice(start, end < 0 ? undefined : end).trim();
      return !/\b(?:stipend|allowance|budget|reimbursement|insurance|bonus)\b/i.test(line) &&
        (/\b(?:salary|compensation|pay|hourly|wage|wages|remuneration)\b/i.test(line) || line.replace(/[.;]$/, '') === m[0].trim());
    }).map(m => m[0].trim());
    if (new Set(amounts).size === 1) {
      salary = amounts[0]; evidence.salary = { status: 'extracted', source: 'JD', raw: salary };
    } else if (amounts.length) evidence.salary = { status: 'ambiguous', source: 'JD', raw: amounts.join('；') };
  } else if (!evidence.salary) evidence.salary = { status: 'extracted', source: '官方岗位字段', raw: salary };
  if (!evidence.salary) evidence.salary = { status: body ? 'not-extracted' : 'unread', source: 'JD', raw: '' };
  if (!evidence.workMode) {
    const match = `${job.location || ''}\n${body}`.match(/(?:work(?:place)? (?:type|mode|arrangement|model)|this (?:role|position) is)\s*:?\s*(?:an?\s+)?(?:hybrid|remote|on[ -]?site)\b/i);
    evidence.workMode = { status: job.workMode !== 'unknown' ? 'extracted' : body ? 'not-extracted' : 'unread', source: match ? 'JD' : '官方地点 / 字段', raw: match?.[0] || (job.workMode !== 'unknown' ? job.location || job.workMode : '') };
  }
  const text = `${job.title || ''}\n${body}`;
  const ranges = [...text.matchAll(/(?:\b(?:duration|term(?: length)?|length)\s*:\s*|\bfor\s+(?:a\s+)?(?:full-time\s+)?)(\d{1,2})\s*(?:[-–]|to)\s*(\d{1,2})[\s-]+months?\b/gi),
    ...text.matchAll(/\b(\d{1,2})\s*(?:[-–]|to)\s*(\d{1,2})[\s-]+months?\s+(?:internship|co[ -]?op|work term|placement)\b/gi)];
  const pairs = [...new Set(ranges.filter(m => +m[1] > 0 && +m[2] >= +m[1]).map(m => `${m[1]}-${m[2]}`))];
  const duration = pairs.length === 1 ? { min: +pairs[0].split('-')[0], max: +pairs[0].split('-')[1] } : null;
  const rawDuration = body.match(/(?:\b(?:duration|term(?: length)?|length)\s*:\s*|\bfor\s+)[^\n.]{0,50}\bmonths?\b/i)?.[0];
  evidence.duration = { status: duration || job.durationMonths ? 'extracted' : body ? 'not-extracted' : 'unread', source: 'JD / 官方标题', raw: rawDuration || (job.durationMonths ? job.title : '') };
  const paid = job.paid === false ? false : /^(?:(?:CAD|USD|GBP|EUR)\s*|(?:CA|US)?\$)\s*[1-9]/i.test(salary) ? true : job.paid;
  return { ...job, paid, salary, ...(duration ? { durationRange: duration, durationMonths: null } : {}), fieldEvidence: evidence };
}
