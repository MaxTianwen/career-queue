import { preserveList } from './page-stability.js';
export function readView(storage, key) {
  try {
    return storage?.getItem('cq-view-' + key) === 'table' ? 'table' : 'cards';
  } catch {
    return 'cards';
  }
}
export function saveView(storage, key, mode) {
  if (!['table', 'cards'].includes(mode)) return;
  try {
    storage?.setItem('cq-view-' + key, mode);
  } catch {}
}
export function mountView(list, key, redraw) {
  let storage;
  try {
    storage = globalThis.localStorage;
  } catch {}
  let mode = readView(storage, key);
  const switcher = document.createElement('div');
  switcher.className = 'view-switch';
  switcher.setAttribute('role', 'group');
  switcher.setAttribute('aria-label', '职位显示方式');
  const buttons = [];
  const update = () =>
    buttons.forEach(([button, value]) => button.setAttribute('aria-pressed', String(mode === value)));
  for (const [value, label] of [
    ['cards', '卡片'],
    ['table', '表格']
  ]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => {
      if (mode === value) return;
      mode = value;
      saveView(storage, key, mode);
      update();
      preserveList(list, redraw);
    });
    switcher.append(button);
    buttons.push([button, value]);
  }
  const controls = document.createElement('div');
  controls.className = 'list-controls';
  const count = document.createElement('p');
  count.className = 'list-meta';
  count.setAttribute('role', 'status');
  count.setAttribute('aria-live', 'polite');
  const refine = document.createElement('button');
  refine.type = 'button';
  refine.className = 'refine-filters';
  refine.textContent = '返回筛选 ↑';
  refine.hidden = true;
  refine.addEventListener('click', () => {
    const filters = list.parentNode.querySelector('.opportunity-filters');
    filters?.scrollIntoView({ block: 'start' });
    filters?.querySelector('input[name=query]')?.focus({ preventScroll: true });
  });
  controls.append(count, refine, switcher);
  list.parentNode.insertBefore(controls, list);
  update();
  const filters = list.parentNode.querySelector('.opportunity-filters');
  if (filters && typeof IntersectionObserver === 'function') {
    const observer = new IntersectionObserver(entries => {
      refine.hidden = entries[0].isIntersecting;
    });
    observer.observe(filters);
  } else refine.hidden = false;
  return () => {
    const meta = [...list.children].find(child => child.classList.contains('list-meta'));
    count.textContent =
      meta?.textContent ||
      [...list.children].filter(child => child.classList.contains('recommendation-card')).length + ' 条学校职位';
    meta?.remove();
    list.classList.toggle('table-view', mode === 'table');
    if (mode !== 'table') return;
    const cards = [...list.children].filter(el => el.classList.contains('recommendation-card'));
    if (!cards.length) return;
    const frame = document.createElement('div');
    frame.className = 'table-scroll';
    frame.tabIndex = 0;
    frame.setAttribute('role', 'region');
    frame.setAttribute('aria-label', '职位表格');
    const table = document.createElement('table');
    table.className = 'opportunity-table';
    const caption = document.createElement('caption');
    caption.textContent = '职位清单 · 与卡片使用相同筛选和操作';
    table.append(caption);
    const head = document.createElement('thead'),
      header = document.createElement('tr');
    for (const title of ['公司 / 职位', '地点', '学期 / 时长 / 发布 / 来源', '申请操作与详情']) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = title;
      header.append(th);
    }
    head.append(header);
    table.append(head);
    const body = document.createElement('tbody');
    for (const card of cards) {
      const row = document.createElement('tr');
      if (card.dataset?.jobId) row.setAttribute('data-job-id', card.dataset.jobId);
      if (card.classList.contains('school-opportunity')) row.className = 'school-opportunity';
      const cells = ['公司 / 职位', '地点', '学期 / 时长 / 发布 / 来源', '申请操作与详情'].map(label => {
        const cell = document.createElement('td');
        cell.setAttribute('data-label', label);
        return cell;
      });
      for (const child of [...card.children]) {
        const target = child.matches('.card-header,h3')
          ? 0
          : child.matches('.card-location')
            ? 1
            : child.matches(
                  '.fact-badges,.route-summary,.card-deadline,.card-publication,.card-freshness,.card-resume-selection'
                )
              ? 2
              : 3;
        cells[target].append(child);
      }
      row.append(...cells);
      body.append(row);
      card.remove();
    }
    table.append(body);
    frame.append(table);
    list.append(frame);
  };
}
