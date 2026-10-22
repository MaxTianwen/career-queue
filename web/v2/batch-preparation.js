import { offlineExchangeUI } from './offline-exchange-ui.js';
// Foreground local preparation only. No model or application-submission requests.
export function chooseBatchResume(job, sources) {
  if (job.resumeSelection) return job.resumeSelection.file?.fileId || null;
  const track = job.jobCategory?.primary === 'embedded' ? 'cs' : job.classification?.track;
  return track === 'cs' ? sources.cs : track === 'data' ? sources.data : null;
}
export async function runBatchItems(items, work, alive = () => true) {
  for (const item of items) {
    if (!alive()) break;
    try {
      await work(item);
    } catch (error) {
      if (alive()) {
        item.status = 'failed';
        item.error = error.message;
      }
    }
  }
}
export function batchPreparation({
  host,
  api,
  preview,
  download,
  openJob = () => {},
  inspectJob = () => {},
  changed = () => {}
}) {
  const el = (tag, text = '') => {
    const n = document.createElement(tag);
    n.textContent = text;
    return n;
  };
  const selected = new Map();
  let files = [],
    epoch = 0,
    running = false;
  const panel = el('details'),
    summary = el('summary'),
    status = el('p'),
    rows = el('div');
  panel.className = 'batch-preparation';
  status.setAttribute('role', 'status');
  panel.append(summary);
  const help = el('details');
  help.className = 'batch-help';
  help.append(
    el('summary', '使用说明'),
    el(
      'p',
      '最多5岗；简历沿用岗位评分原件，可在岗位详情覆盖。移除只取消本次选择，已保存材料和申请记录保留。选择仅保留在当前页面。离线任务包由你自行交给AI或人工处理，本站不会自动发送或投递。'
    )
  );
  panel.append(help);
  const cs = el('select'),
    data = el('select'),
    cover = el('select');
  for (const [control, key, label] of [[cover, 'cover', '求职信上传原件（非定制）']]) {
    control.dataset.source = key;
    const l = el('label', label);
    l.append(control);
    panel.append(l);
  }

  const originals = () =>
    files.filter(f => f.format === 'docx' && f.kind !== 'cover' && (!f.origin || f.origin.kind === 'uploaded'));
  const load = el('button', '读取本人文件'),
    prepare = el('button', '准备所选岗位的逐句对照'),
    generate = el('button', '生成已逐岗审阅的简历');
  for (const b of [load, prepare, generate]) b.type = 'button';
  const local = el('details');
  local.className = 'batch-local';
  local.append(
    el('summary', '本地原文重排'),
    el('p', '仅调整同一经历内原文顺序，不做语义改写或求职信定制；逐岗审阅后生成。'),
    prepare,
    generate
  );
  panel.append(load, local, status, rows);
  host.parentNode.insertBefore(panel, host);
  status.setAttribute('aria-live', 'polite');
  summary.tabIndex = 0;
  const offline = offlineExchangeUI({
    panel,
    api,
    exclusive,
    status,
    preview,
    download,
    selection: async alive => {
      if (!selected.size) throw Error('请先选择岗位');
      const items = [];
      for (const item of selected.values()) {
        await ensureJob(item, alive);
        const choice = await api('/api/jobs/' + item.jobId + '/resume-selection');
        if (!alive()) return [];
        item.job.resumeSelection = choice;
        const resumeId = choice.file?.fileId;
        if (!resumeId || !cover.value)
          throw Error(item.job.company + ' · ' + item.job.title + '：请指定本岗简历及通用CL Word原件');
        await ensureJob(item, alive);
        if (!alive()) return [];
        items.push({ jobId: item.jobId, resumeId, coverId: cover.value });
      }
      return items;
    }
  });
  function update() {
    summary.textContent = '批量准备（' + selected.size + '/5）';
    panel.setAttribute('aria-busy', String(running));
    for (const c of [load, prepare, generate, cs, data, cover]) c.disabled = running;
    prepare.disabled = running || !selected.size;
    generate.disabled = running || ![...selected.values()].some(i => i.draft && i.reviewed && i.openConfirmed);
    offline.setSelectionState(selected.size, running);
  }
  function button(text, run, key) {
    const b = el('button', text);
    b.type = 'button';
    b.disabled = running;
    if (key) b.dataset.action = key;
    b.addEventListener('click', () =>
      Promise.resolve()
        .then(() => {
          if (!running) return run();
        })
        .catch(e => {
          status.textContent = e.message;
        })
    );
    return b;
  }
  async function exclusive(work) {
    if (running) return;
    const ticket = epoch;
    running = true;
    render();
    try {
      await work(() => ticket === epoch);
    } finally {
      if (ticket === epoch) {
        running = false;
        render();
      }
    }
  }
  async function batch(work, items) {
    await exclusive(async alive => {
      await runBatchItems(
        items,
        async item => {
          await work(item, alive);
          if (alive())
            status.textContent =
              '已处理 ' +
              items.filter(x => ['review', 'done', 'reviewed', 'failed'].includes(x.status)).length +
              '/' +
              items.length +
              ' 个岗位；失败可单岗重试。';
        },
        alive
      );
    });
  }
  async function loadFiles(alive) {
    const next = await api('/api/files');
    if (!alive()) return;
    files = next;
    for (const control of [cs, data, cover]) {
      const old = control.value;
      control.replaceChildren(new Option('请选择本人上传文件', ''));
      for (const f of control === cover
        ? files.filter(f => f.kind === 'cover' && (!f.origin || f.origin.kind === 'uploaded'))
        : originals())
        control.add(new Option(f.name + ' · ' + f.id.slice(0, 8), f.id));
      control.value = old;
    }
    status.textContent = '简历使用岗位当前评分选择；请选择求职信原件。';
  }
  async function ensureJob(item, alive) {
    const saved = await api('/api/recommendations/' + item.job.id + '/prepare', { method: 'POST', value: {} });
    if (!alive()) return;
    item.jobId = saved.id;
    item.application = await api('/api/jobs/' + saved.id + '/application');
    return saved;
  }
  async function prepareOne(item, alive) {
    item.status = 'preparing';
    item.error = '';
    item.result = null;
    item.material = null;
    item.images = null;
    item.draft = null;
    item.reviewed = false;
    item.openConfirmed = false;
    item.finalConfirmed = false;
    render();
    await ensureJob(item, alive);
    const choice = await api('/api/jobs/' + item.jobId + '/resume-selection');
    if (!alive()) return;
    item.job.resumeSelection = choice;
    const fileId = choice.file?.fileId;
    if (!fileId) throw Error('请指定本岗CS/Data Word原件；混合或未知方向不能猜测。');
    item.resumeFileId = fileId;
    await api('/api/files/' + fileId + '/parse', { method: 'POST', value: {} });
    if (!alive()) return;
    const saved = await ensureJob(item, alive);
    if (!alive()) return;
    item.coverId = cover.value || null;
    const draft = await api('/api/jobs/' + saved.id + '/generation-draft', {
      method: 'POST',
      value: { resumeFileId: fileId }
    });
    if (!alive()) return;
    item.draft = draft;
    item.choices = Object.fromEntries(draft.groups.map(g => [g.id, false]));
    item.status = 'review';
    render();
  }
  async function generateOne(item, alive) {
    if (!item.draft || !item.reviewed || !item.openConfirmed)
      throw Error('请先准备本岗对照，并核对内容真实和岗位开放状态。');
    item.status = 'generating';
    item.error = '';
    item.images = null;
    item.material = null;
    item.finalConfirmed = false;
    render();
    const draft = item.draft;
    const result = await api('/api/jobs/' + item.jobId + '/generation', {
      method: 'POST',
      value: {
        resumeFileId: item.resumeFileId,
        contextHash: draft.contextHash,
        fingerprint: draft.fingerprint,
        availability: draft.availability,
        decisions: draft.groups.map(g => ({ id: g.id, accepted: item.choices[g.id] === true })),
        confirmed: true,
        openConfirmed: true
      }
    });
    if (!alive()) return;
    item.result = result;
    item.status = 'done';
    render();
  }
  async function restoreOne(item, alive) {
    item.error = '';
    await ensureJob(item, alive);
    if (!alive()) return;
    const versions = await api('/api/jobs/' + item.jobId + '/generation');
    if (!alive()) return;
    const result = versions.find(v => !v.stale);
    if (!result) throw Error('暂无依据仍有效的已生成版本，请重新准备。');
    item.result = result;
    item.resumeFileId = result.snapshot.context.resume.fileId;
    item.draft = null;
    item.images = null;
    item.finalConfirmed = false;
    item.status = 'done';
    render();
  }
  async function previewOne(item, alive) {
    if (!item.result) throw Error('请先生成或恢复本岗版本');
    item.error = '';
    const result = await api('/api/files/' + item.result.pdfId + '/preview', { method: 'POST', value: {} });
    if (!alive()) return;
    if (
      result.pages !== 1 ||
      result.images?.length !== 1 ||
      !result.images.every(s => typeof s === 'string' && /^iVBORw0KGgo[A-Za-z0-9+/=]+$/.test(s))
    )
      throw Error('PDF预览无效');
    item.images = result.images;
    item.finalConfirmed = false;
    item.status = 'done';
    render();
  }
  async function reviewOne(item, alive) {
    if (!item.result || !item.images || !item.finalConfirmed)
      throw Error('请先预览本版PDF，再确认内容和版式；不会记录投递。');
    const context = item.result.snapshot.context;
    const application = await api('/api/jobs/' + item.jobId + '/materials', {
      method: 'POST',
      value: { contextHash: context.hash, resumeFileId: item.result.pdfId, confirmed: true }
    });
    if (!alive()) return;
    item.application = application;
    item.material = application.versions.find(v => v.snapshot.resume.id === item.result.pdfId);
    item.status = 'reviewed';
    render();
  }
  function removeItem(item) {
    if (running || !selected.has(item.job.id)) return;
    selected.delete(item.job.id);
    offline.selectionChanged();
    status.textContent = '已移除 ' + item.job.company + ' · ' + item.job.title + '；已保存材料保留。';
    render();
    changed();
    (rows.querySelector('[data-action=remove]') || summary).focus({ preventScroll: true });
  }
  function render() {
    rows.replaceChildren();
    if (!selected.size) rows.append(el('p', '从岗位列表勾选，开始批量准备。'));
    for (const item of selected.values()) {
      const box = el('article');
      box.className = 'batch-item';
      box.dataset.jobId = item.job.id;
      box.dataset.state = item.status;
      const heading = el('div');
      heading.className = 'batch-item-heading';
      const remove = button('移除', () => removeItem(item), 'remove');
      remove.setAttribute('aria-label', '移除 ' + item.job.company + ' · ' + item.job.title);
      heading.append(el('h3', item.job.company + ' · ' + item.job.title), remove);
      box.append(
        heading,
        el(
          'p',
          {
            selected: '待准备',
            preparing: '正在准备本岗对照',
            review: '待逐岗审阅',
            generating: '正在生成并验证一页版式',
            done: '原文重排稿已生成；非语义定制，未投递',
            reviewed: '重排稿已审阅；非语义定制，待本人投递',
            failed: '本岗失败，可重试'
          }[item.status] || item.status
        )
      );
      box.append(
        el(
          'p',
          '评分与优化原件：' +
            (item.job.resumeSelection?.file?.name || '尚未选择；请在岗位匹配依据设置') +
            ' · ' +
            (item.job.resumeSelection?.classification?.label || '')
        )
      );
      const links = el('div');
      for (const [name, url] of [
        ['官网申请入口', item.job.url],
        ...(item.job.schoolSources || []).flatMap(s => [
          ['学校入口 ' + s.schoolId, s.row?.url],
          ['学校提供的官网入口 ' + s.schoolId, s.row?.externalUrl]
        ])
      ])
        if (url && /^https?:\/\//i.test(url)) {
          const a = el('a', name + ' ↗');
          a.href = url;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          links.append(a, document.createTextNode(' '));
        }
      box.append(links);
      for (const channel of ['employer', 'school'])
        if (item.application?.submissions?.some(s => s.channel === channel))
          box.append(el('p', (channel === 'employer' ? '官网' : '学校') + '：已有提交记录，请到申请区核对'));
      if (item.error) {
        const error = el('p', item.error);
        error.setAttribute('role', 'alert');
        box.append(error);
      }
      const actions = el('div'),
        inspection = el('div');
      inspection.className = 'batch-inspection';
      inspection.hidden = true;
      actions.className = 'batch-item-actions';
      actions.append(
        button('查看JD与依据', () => inspectJob(item.job, false, inspection), 'inspect'),
        button('选择／覆盖简历', () => inspectJob(item.job, true, inspection), 'choose')
      );
      box.append(actions, inspection);
      const more = el('details');
      more.className = 'batch-item-more';
      more.append(
        el('summary', '本地重排与已保存版本'),
        button('重新准备本岗', () => batch(prepareOne, [item]), 'prepare'),
        button('恢复已保存版本', () => batch(restoreOne, [item]), 'restore')
      );
      box.append(more);
      const check = (key, text) => {
        const input = el('input');
        input.type = 'checkbox';
        input.dataset.confirm = key;
        input.checked = !!item[key];
        input.disabled = running;
        input.addEventListener('change', () => {
          item[key] = input.checked;
          update();
        });
        const l = el('label', text);
        l.append(input);
        box.append(l);
      };
      if (item.draft) {
        box.append(
          el('p', '源文件版本：' + item.draft.baseline.version + ' · JD依据：' + item.draft.jdHash),
          el('p', item.draft.engine)
        );
        if (!item.draft.groups.length) box.append(el('p', '没有安全重排建议；导出保留原文，不冒称改写。'));
        for (const group of item.draft.groups) {
          const details = el('details');
          details.append(el('summary', group.label));
          for (const row of group.rows)
            details.append(
              el('p', '原文：' + row.original),
              el('p', '建议：' + row.proposed),
              el('p', '本岗JD：' + row.requirements.map(r => r.quote).join('；'))
            );
          const choice = el('input');
          choice.type = 'checkbox';
          choice.dataset.group = group.id;
          choice.checked = item.choices[group.id] === true;
          choice.disabled = running;
          choice.addEventListener('change', () => {
            item.choices[group.id] = choice.checked;
            item.reviewed = false;
            render();
          });
          const lab = el('label', '应用本组原文重排（未勾选则保留）');
          lab.append(choice);
          details.append(lab);
          box.append(details);
        }
        check('reviewed', '我已审阅本岗逐句对照，内容真实');
        check('openConfirmed', '我已核实此岗位仍开放');
        box.append(button('生成／重试本岗简历', () => batch(generateOne, [item]), 'generate'));
      }
      if (item.result) {
        const context = item.result.snapshot.context;
        box.append(
          el(
            'p',
            '生成版本：' +
              item.result.id +
              ' · 原件版本：' +
              context.resume.fileId +
              ' · 原件SHA256：' +
              context.resume.fileSha
          )
        );
        const pdf = { id: item.result.pdfId, name: '本岗简历.pdf', format: 'pdf' },
          docx = { id: item.result.docxId, name: '本岗简历.docx', format: 'docx' };
        box.append(
          button('预览生成PDF／重试预览', () => batch(previewOne, [item]), 'preview'),
          button('预览Word文字', () => preview(docx), 'word-preview'),
          button('下载PDF', () => download(pdf), 'download-pdf'),
          button('下载Word', () => download(docx), 'download-word')
        );
        if (item.images) {
          const figure = el('figure');
          figure.className = 'batch-pdf-preview';
          for (const data of item.images) {
            const img = el('img');
            img.src = 'data:image/png;base64,' + data;
            img.alt = item.job.title + ' 简历PDF，第1页';
            figure.append(img);
          }
          figure.append(el('figcaption', '当前生成版本 · 1页'));
          box.append(figure);
          check('finalConfirmed', '我已核对这版PDF的内容与版式；仅确认材料，尚未投递');
          box.append(button('确认本岗简历材料', () => batch(reviewOne, [item]), 'review'));
        }
      }
      const original = files.find(f => f.id === item.coverId);
      more.append(
        el(
          'p',
          '求职信：' +
            (original ? '原件 ' + original.name + ' · 版本 ' + original.id + '；尚未按本岗JD定制' : '尚未按本岗JD定制')
        )
      );
      if (original)
        more.append(
          button('预览求职信原件', () => preview(original), 'cover-preview'),
          button('下载求职信原件', () => download(original), 'cover-download')
        );

      if (item.jobId) box.append(button('进入本岗材料与提交确认', () => openJob(item.jobId), 'open-job'));
      rows.append(box);
    }
    update();
  }
  load.addEventListener('click', () => exclusive(loadFiles).catch(e => (status.textContent = e.message)));
  prepare.addEventListener('click', () =>
    batch(prepareOne, [...selected.values()]).catch(e => (status.textContent = e.message))
  );
  generate.addEventListener('click', () =>
    batch(
      generateOne,
      [...selected.values()].filter(x => x.draft && x.reviewed && x.openConfirmed)
    ).catch(e => (status.textContent = e.message))
  );
  update();
  return {
    checkbox(job) {
      if (selected.has(job.id)) selected.get(job.id).job = structuredClone(job);
      const l = el('label', '加入批量准备'),
        c = el('input');
      l.className = 'batch-selection';
      c.type = 'checkbox';
      c.checked = selected.has(job.id);
      c.disabled = running;
      c.addEventListener('change', () => {
        if (running) {
          c.checked = selected.has(job.id);
          status.textContent = '正在处理当前岗位，请等待完成后调整选择。';
          return;
        }
        if (c.checked) {
          if (selected.size >= 5) {
            c.checked = false;
            status.textContent = '一次最多5个岗位。';
            return;
          }
          selected.set(job.id, { job: structuredClone(job), status: 'selected' });
          panel.open = true;
        } else selected.delete(job.id);
        offline.selectionChanged();
        render();
        changed();
      });
      l.append(c);
      return l;
    },
    clear() {
      offline.clear();
      epoch++;
      running = false;
      selected.clear();
      files = [];
      for (const s of [cs, data, cover]) s.replaceChildren();
      rows.replaceChildren();
      status.textContent = '';
      panel.open = false;
      update();
    }
  };
}
