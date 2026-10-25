import { safeHref } from './safe-url.js';

// Stages after a real submission; mirrors src/v2/application-tracking.mjs.
export const STAGE_OPTIONS = [
  ['oa', '测评/OA'],
  ['interview', '面试'],
  ['offer', 'Offer'],
  ['accepted', '已接受'],
  ['rejected', '被拒'],
  ['declined', '已婉拒'],
  ['withdrawn', '主动撤回'],
  ['ghosted', '无回音']
];
export const GROUPS = [
  ['all', '全部'],
  ['active', '进行中'],
  ['oa', '测评/OA'],
  ['interview', '面试'],
  ['offer', 'Offer'],
  ['follow', '待跟进'],
  ['ended', '已结束']
];
const DUE_SOON_DAYS = 3;
const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const tracking = row => row.tracking || { stage: 'submitted', stageLabel: '已提交', events: [], systemNotes: [], facts: {} };
export function dueSoon(row, today) {
  const t = tracking(row);
  if (!t.due || t.ended) return false;
  const days = (Date.parse(t.due.slice(0, 10)) - Date.parse(today)) / 86400000;
  return days <= DUE_SOON_DAYS;
}
export function inGroup(row, group, today) {
  const t = tracking(row);
  if (group === 'all') return true;
  if (group === 'active') return !t.ended;
  if (group === 'ended') return Boolean(t.ended);
  if (group === 'follow') return Boolean(t.followUp) || dueSoon(row, today);
  return t.stage === group;
}
export function filterApplications(rows, { group = 'all', query = '' } = {}, today) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter(row => {
    if (!inGroup(row, group, today)) return false;
    if (!words.length) return true;
    const t = tracking(row),
      text = [row.company, row.title, t.facts.location, t.facts.term, t.nextStep, t.contact, t.notes, t.stageLabel]
        .join(' ')
        .toLowerCase();
    return words.every(word => text.includes(word));
  });
}
// Open items with a deadline first (soonest first), then everything else by newest application.
export function sortApplications(rows) {
  const key = row => {
    const t = tracking(row);
    return [t.due && !t.ended ? 0 : 1, t.due && !t.ended ? t.due : '', t.appliedDate || ''];
  };
  return [...rows].sort((a, b) => {
    const x = key(a),
      y = key(b);
    if (x[0] !== y[0]) return x[0] - y[0];
    if (x[1] !== y[1]) return x[1].localeCompare(y[1]);
    return y[2].localeCompare(x[2]);
  });
}
export function groupCounts(rows, today) {
  return Object.fromEntries(GROUPS.map(([key]) => [key, rows.filter(row => inGroup(row, key, today)).length]));
}
export function dueLabel(due) {
  return due ? due.replace('T', ' ') : '';
}
export function stageBadge(row, today) {
  const t = tracking(row),
    wrap = el('span', undefined, 'tracking-stage-wrap'),
    badge = el('span', t.stageLabel, 'tracking-stage');
  badge.dataset.stage = t.stage;
  wrap.append(badge);
  const attention = t.followUp ? '待跟进' : dueSoon(row, today) ? '临近截止' : '';
  if (attention) wrap.append(el('span', attention, 'tracking-attention'));
  return wrap;
}

// Summary chips double as the filter; search and export sit beside them.
export function renderTrackerBar(host, rows, state, { today, onChange, onExport }) {
  host.replaceChildren();
  const counts = groupCounts(rows, today),
    chips = el('div', undefined, 'tracking-groups');
  chips.setAttribute('role', 'group');
  chips.setAttribute('aria-label', '按进度筛选申请记录');
  for (const [key, label] of GROUPS) {
    const chip = el('button', undefined, 'tracking-group');
    chip.type = 'button';
    chip.dataset.group = key;
    chip.setAttribute('aria-pressed', String(state.group === key));
    chip.append(el('span', label), el('strong', String(counts[key])));
    chip.addEventListener('click', () => onChange({ ...state, group: key }));
    chips.append(chip);
  }
  const tools = el('div', undefined, 'tracking-tools'),
    search = document.createElement('input');
  search.type = 'search';
  search.name = 'tracking-query';
  search.placeholder = '搜索公司、职位、地点、备注';
  search.setAttribute('aria-label', '搜索申请记录');
  search.value = state.query;
  search.addEventListener('input', () => onChange({ ...state, query: search.value }, true));
  const exportButton = el('button', '导出 Excel', 'tracking-export');
  exportButton.type = 'button';
  exportButton.addEventListener('click', onExport);
  const exportStatus = el('p', '', 'tracking-export-status');
  exportStatus.id = 'tracking-export-status';
  exportStatus.setAttribute('role', 'status');
  tools.append(search, exportButton);
  host.append(chips, tools, exportStatus);
}

// Follow-up editor: stage timeline plus next step, deadline, contact and notes.
export function openTrackingDialog(row, { api, action, localDate, onSaved }) {
  document.querySelector('#tracking-dialog')?.remove();
  const t = tracking(row),
    f = t.facts;
  const dialog = el('dialog', undefined, 'tracking-dialog');
  dialog.id = 'tracking-dialog';
  dialog.setAttribute('aria-labelledby', 'tracking-dialog-title');
  const heading = el('div', undefined, 'heading'),
    title = el('h2', `${f.company || row.company} · ${f.title || row.title}`);
  title.id = 'tracking-dialog-title';
  const close = el('button', '关闭', 'quiet');
  close.type = 'button';
  close.addEventListener('click', () => dialog.close());
  heading.append(title, close);
  dialog.append(heading);

  const facts = el('dl', undefined, 'tracking-facts');
  for (const [label, value] of [
    ['申请日期', t.appliedDate || '未知'],
    ['当前进度', t.stageLabel + (t.stageDate ? ' · ' + t.stageDate : '')],
    ['地点', f.location],
    ['学期', f.term],
    ['时长', f.duration],
    ['薪资', f.salary],
    ['办公方式', f.workMode]
  ]) {
    if (!value) continue;
    facts.append(el('dt', label), el('dd', value));
  }
  const href = safeHref(f.url);
  if (href) {
    const link = el('a', '打开官网岗位');
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    const dd = el('dd');
    dd.append(link);
    facts.append(el('dt', '官网'), dd);
  }
  dialog.append(facts);
  dialog.append(
    el(
      'p',
      t.factsSource === 'snapshot' ? '岗位信息为提交时保存的快照。' : '岗位信息来自当前岗位列表，下次保存时会留存快照。',
      'muted'
    )
  );

  const timeline = el('section', undefined, 'tracking-timeline');
  timeline.append(el('h3', '进展时间线'));
  const list = el('ol');
  for (const s of row.submissions || [])
    list.append(el('li', `${s.date || '日期未知'} · 已提交（${s.channel === 'school' ? '学校' : '官网'}）`));
  for (const event of t.events) {
    const item = el('li');
    item.append(el('span', `${event.date} · ${event.label}${event.note ? ' · ' + event.note : ''}`, 'tracking-event'));
    if (event.voided) {
      item.dataset.voided = 'true';
      item.append(el('span', ` （已撤销：${event.voidReason || ''}）`, 'muted'));
    } else {
      const undo = el('button', '撤销', 'quiet tracking-void');
      undo.type = 'button';
      undo.setAttribute('aria-label', `撤销 ${event.date} ${event.label}`);
      undo.addEventListener('click', () =>
        action(status, async () => {
          const next = await api(`/api/jobs/${row.jobId}/stage-events/${event.id}/void`, {
            method: 'POST',
            value: { reason: '本人撤销误记的阶段' }
          });
          await onSaved(next, '已撤销该进展；记录保留在时间线中。');
        })
      );
      item.append(' ', undo);
    }
    list.append(item);
  }
  timeline.append(list);

  const stageForm = el('form', undefined, 'tracking-stage-form');
  const stageRequest = crypto.randomUUID();
  const stage = document.createElement('select');
  stage.name = 'stage';
  for (const [value, label] of STAGE_OPTIONS) stage.append(new Option(label, value));
  const date = document.createElement('input');
  date.type = 'date';
  date.name = 'date';
  date.required = true;
  date.max = localDate();
  date.value = localDate();
  const note = document.createElement('input');
  note.name = 'note';
  note.maxLength = 500;
  note.placeholder = '说明（如：第 1 轮技术面）';
  const labelled = (text, input) => {
    const label = el('label', text);
    label.append(input);
    return label;
  };
  const addStage = el('button', '记录进展', 'primary');
  stageForm.append(labelled('阶段', stage), labelled('日期', date), labelled('说明', note), addStage);
  stageForm.addEventListener('submit', event => {
    event.preventDefault();
    action(status, async () => {
      const next = await api(`/api/jobs/${row.jobId}/stage-events`, {
        method: 'POST',
        value: {
          stage: stage.value,
          date: date.value,
          note: note.value,
          requestId: stageRequest,
          timezoneOffset: new Date().getTimezoneOffset()
        }
      });
      await onSaved(next, '进展已记录。');
    });
  });
  timeline.append(stageForm);
  dialog.append(timeline);

  const details = el('form', undefined, 'tracking-details');
  const detailRequest = crypto.randomUUID();
  details.append(el('h3', '跟进信息'));
  const field = (name, label, value, multiline = false) => {
    const input = document.createElement(multiline ? 'textarea' : 'input');
    input.name = name;
    input.value = value;
    input.maxLength = name === 'notes' ? 5000 : 500;
    if (multiline) input.rows = 3;
    details.append(labelled(label, input));
    return input;
  };
  field('nextStep', '下一步', t.nextStep);
  const dueDate = document.createElement('input'),
    dueTime = document.createElement('input');
  dueDate.type = 'date';
  dueDate.name = 'dueDate';
  dueDate.value = t.due.slice(0, 10);
  dueTime.type = 'time';
  dueTime.name = 'dueTime';
  dueTime.value = t.due.slice(11, 16);
  const dueRow = el('div', undefined, 'tracking-due');
  dueRow.append(labelled('截止日期', dueDate), labelled('时间（可选）', dueTime));
  details.append(dueRow);
  field('contact', '联系人 / 内推', t.contact);
  field('notes', '备注', t.notes, true);
  const saveDetails = el('button', '保存跟进信息', 'primary');
  details.append(saveDetails);
  details.addEventListener('submit', event => {
    event.preventDefault();
    action(status, async () => {
      if (dueTime.value && !dueDate.value) throw new Error('填写时间前请先选择截止日期');
      const next = await api(`/api/jobs/${row.jobId}/tracking`, {
        method: 'PUT',
        value: {
          revision: t.revision,
          requestId: detailRequest,
          nextStep: details.elements.nextStep.value,
          due: dueDate.value ? dueDate.value + (dueTime.value ? 'T' + dueTime.value : '') : '',
          contact: details.elements.contact.value,
          notes: details.elements.notes.value
        }
      });
      await onSaved(next, '跟进信息已保存。');
    });
  });
  dialog.append(details);

  if (t.systemNotes.length) {
    const notes = el('section', undefined, 'tracking-system-notes');
    notes.append(el('h3', '系统备注'));
    const items = el('ul');
    for (const text of t.systemNotes) items.append(el('li', text));
    notes.append(items);
    dialog.append(notes);
  }
  const status = el('p', '', 'tracking-status');
  status.id = 'tracking-status';
  status.setAttribute('role', 'status');
  dialog.append(status);
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  stage.focus();
  return dialog;
}
