const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
export function deadlineExpired(deadline, now = new Date()) {
  if (typeof deadline !== 'string') return false;
  if (validDate(deadline)) {
    // A date without a stated time remains open through that date in Toronto.
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    return deadline < today;
  }
  return validDate(deadline.slice(0, 10)) && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(deadline) && Number.isFinite(Date.parse(deadline)) && Date.parse(deadline) < now.getTime();
}

export function extractDeadline(job) {
  if (job.jdSource === 'school' && !job.url) return { deadline: null, deadlineEvidence: null };
  if (job.deadline) return { deadline: job.deadline, deadlineEvidence: job.deadlineEvidence || '已记录的截止日期' };
  const lines = String(job.jd || '').match(/(?:application\s+(?:submission\s+)?deadline|applications?\s+(?:close|due)|closing\s+date|apply\s+by|deadline\s+to\s+apply)\s*(?:is|on|:)?\s*[^\n]{0,160}/gi) || [];
  const found = [];
  for (const line of lines) {
    const value = line.replace(/^(?:application\s+(?:submission\s+)?deadline|applications?\s+(?:close|due)|closing\s+date|apply\s+by|deadline\s+to\s+apply)\s*(?:is\b|on\b|:)?\s*/i, '');
    let date = value.match(/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?\b/)?.[0];
    if (!date) {
      const m = value.match(/^(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(20\d{2})\b/i);
      if (m) {
        const month = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
        date = `${m[3]}-${String(month).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
      }
    }
    if (date && validDate(date)) {
      const time = value.match(/(?:at\s+|\s)(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\s*\(?(UTC|GMT|EST|EDT|PST|PDT)\b/i);
      if (time) {
        const meridiem = time[3]?.[0].toLowerCase();
        const hour = meridiem ? Number(time[1]) % 12 + (meridiem === 'p' ? 12 : 0) : Number(time[1]);
        const minute = Number(time[2] || 0);
        const offsets = { UTC: '+00:00', GMT: '+00:00', EST: '-05:00', EDT: '-04:00', PST: '-08:00', PDT: '-07:00' };
        if (hour < 24 && minute < 60 && (!meridiem || Number(time[1]) >= 1 && Number(time[1]) <= 12)) date += `T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00${offsets[time[4].toUpperCase()]}`;
      }
    }
    if (date && validDate(date.slice(0, 10)) && Number.isFinite(Date.parse(date))) found.push({ deadline: date, deadlineEvidence: line.trim() });
  }
  // Conflicting dates need review; do not choose one arbitrarily.
  return new Set(found.map(x => x.deadline)).size === 1 ? found[0] : { deadline: null, deadlineEvidence: lines.length ? `待核实：${lines.join('；')}` : null };
}
