import { dueLabel, stageBadge } from './application-tracker.js';
import { safeHref } from './safe-url.js';

export function applicationCells(row) {
  const submitted = new Set(row.submissions.map(s => s.channel)),
    school = Boolean(row.schoolContext) || submitted.has('school');
  const status = [];
  for (const [key, label] of [
    ['school', '学校'],
    ['employer', '官网']
  ]) {
    if (submitted.has(key)) status.push(label + '已提交');
    else if (row.channelProgress?.missing?.includes(key)) status.push(label + '待提交');
    else if (key === 'employer' && school && row.channelProgress?.employer === '待确认') status.push('官网待确认');
  }
  const facts = row.tracking?.facts || {};
  return {
    company: row.company,
    title: row.title,
    source: school ? '学校' : '官网',
    status,
    dates: row.submissions.map(s => ({
      channel: s.channel,
      label: s.channel === 'school' ? '学校' : '官网',
      date: s.date || '—'
    })),
    appliedDate: row.tracking?.appliedDate || '',
    place: [facts.location, facts.term, facts.duration].filter(Boolean).join(' · '),
    salary: facts.salary || '',
    url: safeHref(facts.url) || '',
    nextStep: row.tracking?.nextStep || '',
    due: dueLabel(row.tracking?.due || '')
  };
}
export function renderApplicationTable(container, rows, details, { track, today, total = rows.length } = {}) {
  container.replaceChildren();
  const el = (tag, text) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    return n;
  };
  if (!rows.length) {
    container.append(el('p', total ? '没有符合当前筛选的记录。' : '尚无已提交记录。'));
    return;
  }
  const hint = el('p', '左右滑动查看完整表格');
  hint.className = 'application-table-hint';
  const frame = el('div');
  frame.className = 'application-table-scroll';
  frame.tabIndex = 0;
  frame.setAttribute('role', 'region');
  frame.setAttribute('aria-label', '申请记录表格，可横向滚动');
  const table = el('table');
  table.className = 'application-table';
  const caption = el(
    'caption',
    '申请记录 · ' + (rows.length === total ? rows.length + ' 个岗位' : `显示 ${rows.length} / ${total} 个岗位`)
  );
  table.append(caption);
  const head = el('thead'),
    header = el('tr');
  for (const title of ['申请日期', '公司', '职位', '渠道', '进度', '下一步 · 截止', '地点 · 学期', '薪资', '操作']) {
    const th = el('th', title);
    th.scope = 'col';
    header.append(th);
  }
  head.append(header);
  table.append(head);
  const body = el('tbody');
  for (const row of rows) {
    const data = applicationCells(row),
      tr = el('tr');
    tr.dataset.jobId = row.jobId;
    const applied = el('td'),
      known = Boolean(data.appliedDate),
      appliedStamp = el(known ? 'time' : 'span', known ? data.appliedDate : '—');
    applied.className = 'application-applied';
    appliedStamp.className = known ? 'application-date-value' : 'application-date-unknown';
    if (known) appliedStamp.dateTime = data.appliedDate;
    else appliedStamp.setAttribute('aria-label', '申请日期未知');
    applied.append(appliedStamp);
    const company = el('th');
    company.scope = 'row';
    company.className = 'application-company';
    const companyText = el('span', data.company);
    companyText.className = 'application-company-text';
    companyText.title = data.company;
    company.append(companyText);
    const title = el('td'),
      titleText = el('span', data.title);
    titleText.className = 'application-title-text';
    titleText.title = data.title;
    title.append(titleText);
    const state = el('td'),
      progress = el('td'),
      next = el('td'),
      place = el('td', data.place || '—'),
      salary = el('td', data.salary || '—'),
      action = el('td');
    state.className = 'application-state';
    progress.className = 'application-progress';
    next.className = 'application-next';
    place.className = 'application-place';
    salary.className = 'application-salary';
    action.className = 'application-action';
    for (const value of data.status) {
      const badge = el('span', value.slice(0, 2) + ' · ' + value.slice(2));
      badge.className = 'application-status-badge';
      badge.dataset.state = value.endsWith('已提交') ? 'submitted' : 'pending';
      const matched = data.dates.find(d => d.label === value.slice(0, 2));
      if (matched && matched.date !== '—' && data.dates.length > 1) badge.title = '提交日期 ' + matched.date;
      state.append(badge);
    }
    progress.append(stageBadge(row, today));
    if (row.tracking?.stageDate && row.tracking.stage !== 'submitted') {
      const stageDate = el('span', row.tracking.stageDate);
      stageDate.className = 'application-stage-date';
      progress.append(stageDate);
    }
    if (data.nextStep) {
      const text = el('span', data.nextStep);
      text.className = 'application-next-text';
      text.title = data.nextStep;
      next.append(text);
    }
    if (data.due) {
      const due = el('time', data.due);
      due.dateTime = row.tracking.due;
      due.className = 'application-due';
      next.append(due);
    }
    if (!data.nextStep && !data.due) next.textContent = '—';
    if (track) {
      const button = el('button', '跟进');
      button.type = 'button';
      button.className = 'application-track-button';
      button.setAttribute('aria-label', '记录 ' + data.company + ' · ' + data.title + ' 的进展');
      button.addEventListener('click', () => track(row));
      action.append(button);
    }
    const button = el('button', '材料');
    button.type = 'button';
    button.className = 'application-detail-button';
    button.setAttribute('aria-label', '查看 ' + data.company + ' · ' + data.title + ' 的申请材料');
    button.addEventListener('click', () => details(row.jobId));
    action.append(button);
    if (data.url) {
      const link = el('a', '官网');
      link.href = data.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'application-link';
      link.setAttribute('aria-label', '打开 ' + data.company + ' · ' + data.title + ' 的官网岗位');
      action.append(link);
    }
    tr.append(applied, company, title, state, progress, next, place, salary, action);
    body.append(tr);
  }
  table.append(body);
  frame.append(table);
  container.append(hint, frame);
}
