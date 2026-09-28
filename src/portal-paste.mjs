const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const clean = value => String(value || '').replace(/\*\*|__/g, '').replace(/\u00a0/g, ' ').trim();
const dateValid = date => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;

// Keep the source text; a school time without a zone uses our Toronto convention.
export function schoolDeadline(value) {
  const text = clean(value);
  if (!text) return { deadline: '', deadlineText: '' };
  if (dateValid(text)) return { deadline: text, deadlineText: text };
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(text) && dateValid(text.slice(0, 10)) && Number.isFinite(Date.parse(text))) return { deadline: text, deadlineText: text };
  const m = text.match(/^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(20\d{2})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM))?$/i);
  const month = m && months.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
  const date = m && `${m[3]}-${String(month).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  if (!month || !dateValid(date)) throw new Error('无法识别学校截止时间，请保留原文核对或填写 YYYY-MM-DD');
  if (!m[4]) return { deadline: date, deadlineText: text };
  if (+m[4] < 1 || +m[4] > 12 || +m[5] > 59) throw new Error('学校截止时间无效');
  const hour = +m[4] % 12 + (m[6].toUpperCase() === 'PM' ? 12 : 0);
  const local = `${date}T${String(hour).padStart(2, '0')}:${m[5]}:00`;
  const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const candidates = ['-04:00', '-05:00'].map(offset => local + offset).filter(iso => fmt.format(new Date(iso)).replace(' ', 'T') === local);
  if (candidates.length !== 1) throw new Error('学校时间处于夏令时切换边界，请填写带明确时区的时间');
  return { deadline: candidates[0], deadlineText: text };
}

const headers = { 'app status': 'sourceStatus', term: 'term', id: 'id', 'job title': 'title', organization: 'company', location: 'location', 'app deadline': 'deadline' };
const splitRow = (line, markdown) => markdown ? line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(v => v.replace(/\\\|/g, '|')) : line.split('\t');
const linkText = text => clean(text).replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1');

export function parsePortalPaste(text) {
  if (typeof text !== 'string' || !text.trim() || text.length > 150000) throw new Error('请粘贴学校列表文字，每批不超过 150,000 字符');
  const lines = text.split(/\r?\n/), rows = [], errors = [], warnings = [];
  let columns, markdown;
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    const isMarkdown = line.trim().startsWith('|');
    const cells = splitRow(line, isMarkdown).map(clean);
    const mapped = cells.map(c => headers[c.toLowerCase()]);
    if (['id', 'title', 'company', 'term'].every(name => mapped.includes(name))) { columns = mapped; markdown = isMarkdown; continue; }
    if (!columns || /^\s*\|?[\s:|-]+\|?\s*$/.test(line)) continue;
    if (markdown !== isMarkdown || (!markdown && !line.includes('\t'))) {
      if (/20\d{2}\s*-\s*(winter|summer|fall)/i.test(line)) errors.push(`第 ${index + 1} 行未保留表格分隔，请重新复制该行`);
      continue;
    }
    if (cells.length !== columns.length) { errors.push(`第 ${index + 1} 行列数不完整，未导入`); continue; }
    const row = Object.fromEntries(columns.flatMap((key, i) => key ? [[key, linkText(cells[i])]] : []));
    if (!/^\d+$/.test(row.id || '') || !row.company || !row.title) { errors.push(`第 ${index + 1} 行缺少有效学校 ID、公司或标题，未导入`); continue; }
    row.title = row.title.replace(/^NEW\s+/i, '');
    row.term = row.term.replace(/^(20\d{2})\s*-\s*(Winter|Summer|Fall)$/i, (_, year, term) => `${term[0].toUpperCase()}${term.slice(1).toLowerCase()} ${year}`);
    row.requisitionId = row.title.match(/\b(JR\d+)\s*$/i)?.[1] || row.title.match(/[[(](\d{5,})[\])]\s*$/)?.[1] || '';
    row.url = ['title', 'id'].map(k => cells[columns.indexOf(k)]?.match(/\]\((https?:\/\/[^\s)]+)\)/)?.[1]).find(Boolean) || '';
    row.externalUrl = '';
    try { Object.assign(row, schoolDeadline(row.deadline)); }
    catch (error) { row.deadlineText = row.deadline; row.deadline = ''; row.parseWarning = error.message; }
    rows.push(row);
  }
  if (!columns) throw new Error('未识别到学校表头。请连同 Term、ID、Job Title、Organization 等表头一起复制；支持网页制表符和 Markdown 表格。');
  if (!rows.length) throw new Error('未识别到完整职位行，请连同表头重新复制列表');
  if (rows.length > 100) throw new Error('每批最多 100 条，请分批粘贴');
  const total = clean(text).match(/TOTAL RESULTS:\s*(\d+)/i);
  const reportedTotal = total ? Number(total[1]) : null;
  if (reportedTotal !== null && reportedTotal !== rows.length) warnings.push(`页面显示 ${reportedTotal} 条，本次仅识别 ${rows.length} 条；未复制的职位不会参与匹配。`);
  if (rows.some(r => !r.url)) warnings.push('复制内容未包含部分学校链接：仍可按学校 ID 匹配，关联后可补充链接。');
  if (rows.some(r => /AM|PM/i.test(r.deadlineText || ''))) warnings.push('截止时间原文未标时区，按多伦多时间解释；保留原文供核对。');
  const duplicates = rows.filter((r, i) => rows.some((s, j) => j !== i && (s.id === r.id || (r.requisitionId && s.requisitionId === r.requisitionId && s.company === r.company && s.term === r.term))));
  if (duplicates.length) warnings.push(`学校记录 ${duplicates.map(r => r.id).join('、')} 的学校 ID 或雇主编号重复，请核对并只选择正确关联；不覆盖其他学校记录。`);
  return { rows, reportedTotal, parsedCount: rows.length, warnings, errors };
}
