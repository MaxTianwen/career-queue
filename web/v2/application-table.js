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
  return {
    company: row.company,
    title: row.title,
    source: school ? '学校' : '官网',
    status,
    dates: row.submissions.map(s => ({
      channel: s.channel,
      label: s.channel === 'school' ? '学校' : '官网',
      date: s.date || '—'
    }))
  };
}
export function renderApplicationTable(container, rows, details) {
  container.replaceChildren();
  const el = (tag, text) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    return n;
  };
  if (!rows.length) {
    container.append(el('p', '尚无已提交记录。'));
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
  const caption = el('caption', '申请记录 · ' + rows.length + ' 个岗位');
  table.append(caption);
  const head = el('thead'),
    header = el('tr');
  for (const title of ['公司', '职位', '来源', '申请状态', '申请日期', '操作']) {
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
    const source = el('td'),
      state = el('td'),
      date = el('td'),
      action = el('td');
    source.className = 'application-source';
    state.className = 'application-state';
    date.className = 'application-dates';
    action.className = 'application-action';
    const sourceBadge = el('span', data.source);
    sourceBadge.className = 'application-source-badge';
    sourceBadge.dataset.source = data.source === '学校' ? 'school' : 'external';
    source.append(sourceBadge);
    for (const value of data.status) {
      const badge = el('span', value.slice(0, 2) + ' · ' + value.slice(2));
      badge.className = 'application-status-badge';
      badge.dataset.state = value.endsWith('已提交') ? 'submitted' : 'pending';
      state.append(badge);
      const matched = data.dates.find(d => d.label === value.slice(0, 2)),
        known = matched && matched.date !== '—';
      const line = el('div'),
        channel = el('span', value.slice(0, 2)),
        stamp = el(known ? 'time' : 'span', known ? matched.date : '—');
      channel.className = 'application-date-channel';
      stamp.className = known ? 'application-date-value' : 'application-date-unknown';
      if (known) stamp.dateTime = matched.date;
      else stamp.setAttribute('aria-label', '申请日期未知或尚未提交');
      line.className = 'application-date-line';
      line.append(channel, stamp);
      date.append(line);
    }
    const button = el('button', '详情');
    button.type = 'button';
    button.className = 'application-detail-button';
    button.setAttribute('aria-label', '查看 ' + data.company + ' · ' + data.title + ' 的申请详情');
    button.addEventListener('click', () => details(row.jobId));
    action.append(button);
    tr.append(company, title, source, state, date, action);
    body.append(tr);
  }
  table.append(body);
  frame.append(table);
  container.append(hint, frame);
}
