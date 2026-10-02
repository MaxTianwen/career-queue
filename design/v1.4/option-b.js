(() => {
  'use strict';

  const data = window.CQ_DEMO;
  const list = document.getElementById('job-list');
  if (!data || !Array.isArray(data.jobs) || !data.resume) {
    list.innerHTML = '<div class="empty-state"><h2>示例数据尚未加载</h2><p>请确认 demo-data.js 与此页面在同一目录，然后重新打开页面。</p></div>';
    return;
  }

  const jobs = data.jobs;
  const saved = new Set();
  const drafts = new Map();
  const screens = ['discovery', 'detail', 'review'];
  const modes = { hybrid: '混合办公', onsite: '现场办公', remote: '远程办公' };
  const tracks = { cs: 'Computer Science', data: 'Data & Analytics', mixed: 'CS / Data 交叉方向' };
  let scope = 'discover';
  let screen = 'discovery';
  let selectedId = null;
  let listScroll = 0;
  let listJobId = null;
  let toastTimer;
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const formatDate = (value) => value ? String(value).replaceAll('-', '.') : '日期未知';
  const findJob = (id) => jobs.find((job) => String(job.id) === String(id));
  const originalText = data.resume.bullets.join('\n\n');
  const suggestedBullets = [...data.resume.bullets].reverse();
  const bookmark = '<svg viewBox="0 0 20 24" aria-hidden="true"><path d="M4 3h12v18l-6-4-6 4z"/></svg>';

  function highlightSkills(value, skills) {
    const text = String(value);
    const lower = text.toLowerCase();
    let cursor = 0;
    let result = '';
    while (cursor < text.length) {
      const next = skills.filter(Boolean).map((skill) => ({ skill, index: lower.indexOf(skill.toLowerCase(), cursor) }))
        .filter((match) => match.index >= 0).sort((a, b) => a.index - b.index || b.skill.length - a.skill.length)[0];
      if (!next) break;
      result += escape(text.slice(cursor, next.index)) + `<mark class="skill-highlight">${escape(text.slice(next.index, next.index + next.skill.length))}</mark>`;
      cursor = next.index + next.skill.length;
    }
    return result + escape(text.slice(cursor));
  }

  [...new Set(jobs.map((job) => job.season))].sort().forEach((season) => {
    document.getElementById('season-filter').add(new Option(season, season));
  });
  document.getElementById('total-count').textContent = String(jobs.length).padStart(2, '0');

  function notify(message) {
    clearTimeout(toastTimer);
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.hidden = false;
    toastTimer = setTimeout(() => { toast.hidden = true; }, 4800);
  }

  function updateNavigation() {
    document.getElementById('saved-count').textContent = saved.size;
    document.querySelectorAll('.primary-nav [data-action]').forEach((button) => {
      const active = button.dataset.action === scope;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
  }

  function showScreen(next, restoreList = false) {
    screen = next;
    screens.forEach((name) => { document.getElementById(`${name}-screen`).hidden = name !== next; });
    updateNavigation();
    const returnTitle = restoreList ? [...list.querySelectorAll('[data-action="detail"]')].find((button) => button.dataset.id === listJobId) : null;
    (returnTitle || document.getElementById('main')).focus({ preventScroll: true });
    window.scrollTo({ top: restoreList ? listScroll : 0, behavior: 'instant' });
  }

  function filterJobs() {
    const query = document.getElementById('query-filter').value.trim().toLowerCase();
    const season = document.getElementById('season-filter').value;
    const track = document.getElementById('track-filter').value;
    const duration = document.getElementById('duration-filter').value;
    const region = document.getElementById('region-filter').value;
    const mode = document.getElementById('mode-filter').value;
    const sort = document.getElementById('sort-filter').value;
    return jobs.filter((job) => (scope !== 'saved' || saved.has(String(job.id)))
      && (!query || [job.company, job.title, ...job.skills].join(' ').toLowerCase().includes(query))
      && (!season || job.season === season)
      && (!track || job.track === track)
      && (!duration || job.duration === Number(duration))
      && (!region || job.region === region)
      && (!mode || job.mode === mode))
      .sort((a, b) => sort === 'deadline' ? String(a.deadline || '9999').localeCompare(String(b.deadline || '9999'))
        : sort === 'posted' ? String(b.posted || '').localeCompare(String(a.posted || '')) : b.score - a.score);
  }

  function renderList() {
    const filtered = filterJobs();
    document.getElementById('discovery-title').textContent = scope === 'saved' ? '已保存的职位' : '发现职位';
    document.getElementById('discovery-description').textContent = scope === 'saved' ? '你的本页示例短名单；刷新后恢复为空。' : '把方向、任期和地点放在一起比较。';
    document.getElementById('result-count').innerHTML = `显示 <strong>${filtered.length}</strong> 个职位<span> · ${scope === 'saved' ? '本页已保存' : '全部为合成示例'}</span>`;
    if (!filtered.length) {
      const emptySaved = scope === 'saved' && !saved.size;
      list.innerHTML = `<div class="empty-state"><span class="serif-number">${emptySaved ? 'Your shortlist.' : 'No matches.'}</span><h2>${emptySaved ? '留下一份值得继续了解的机会' : '当前条件下没有示例职位'}</h2><p>${emptySaved ? '在职位行点击书签，把示例岗位放进这里。' : '可以放宽筛选条件，重新比较。'}</p><button class="button" type="button" data-action="${emptySaved ? 'discover' : 'reset'}">${emptySaved ? '返回发现职位' : '重置筛选条件'} <span aria-hidden="true">→</span></button></div>`;
    } else {
      list.innerHTML = filtered.map((job) => {
        const isSaved = saved.has(String(job.id));
        return `<article class="job-row" aria-label="${escape(job.company)} ${escape(job.title)}">
          <div class="job-role"><p class="company">${escape(job.company)}</p><button type="button" class="job-title" data-action="detail" data-id="${escape(job.id)}">${escape(job.title)}</button><p class="track-label">${escape(tracks[job.track])}</p></div>
          <div><p class="cell-primary">${escape(job.season)} · ${escape(job.duration)} 个月</p><p class="cell-secondary">${escape(job.salary)}</p></div>
          <div><p class="cell-primary">${escape(job.city)}</p><p class="cell-secondary">${escape(modes[job.mode])}</p></div>
          <div class="score-cell" aria-label="示例覆盖分 ${escape(job.score)}，满分 100"><span class="score-number">${escape(job.score)}</span><span class="score-total">/ 100</span></div>
          <button type="button" class="save-icon${isSaved ? ' saved' : ''}" data-action="save" data-id="${escape(job.id)}" aria-label="${isSaved ? '撤销保存' : '保存示例岗位'}：${escape(job.title)}" aria-pressed="${isSaved}" title="${isSaved ? '撤销本页保存' : '保存到示例 Queue'}">${bookmark}</button>
        </article>`;
      }).join('');
    }
    updateNavigation();
  }

  function saveLabel(job) {
    return saved.has(String(job.id)) ? '已保存 · 点击撤销' : '保存到示例 Queue';
  }

  function renderDetail() {
    const job = findJob(selectedId);
    if (!job) return;
    document.getElementById('detail-screen').innerHTML = `
      <button type="button" class="back-button" data-action="back-list">← 返回${scope === 'saved' ? '已保存职位' : '职位列表'}</button>
      <div class="detail-heading"><div><p class="eyebrow">02 / POSITION DETAILS</p><h1 id="detail-title">${escape(job.title)}</h1><p class="detail-subtitle">${escape(job.company)} <span aria-hidden="true"> / </span> ${escape(tracks[job.track])} <span aria-hidden="true"> / </span> 合成岗位</p></div><div class="button-row"><button type="button" class="button" data-action="save" data-id="${escape(job.id)}" aria-pressed="${saved.has(String(job.id))}">${saveLabel(job)}</button></div></div>
      <dl class="job-facts"><div><dt>任期</dt><dd>${escape(job.season)} · ${escape(job.duration)} 个月</dd></div><div><dt>地点与办公</dt><dd>${escape(job.city)} · ${escape(modes[job.mode])}</dd></div><div><dt>示例薪资</dt><dd>${escape(job.salary)}</dd></div><div><dt>示例截止日期</dt><dd>${formatDate(job.deadline)}</dd></div></dl>
      <div class="detail-columns"><div>
        <section class="content-section"><h2 class="section-title"><span class="section-number">01</span>岗位概览</h2><p class="body-copy">${escape(job.summary)}</p></section>
        <section class="content-section"><h2 class="section-title"><span class="section-number">02</span>示例岗位要求</h2><ul class="requirements">${job.requirements.map((requirement) => `<li>${highlightSkills(requirement, job.skills)}</li>`).join('')}</ul><p class="source-note">暖色高亮为示例技能对应，不证明资格满足。正文与要求仅为设计演示，未读取实际 JD。示例发布日期：${formatDate(job.posted)}。</p></section>
        <section class="content-section"><h2 class="section-title"><span class="section-number">03</span>信息依据</h2><p class="body-copy">岗位来源、公司、薪资与截止日期均来自合成设计数据。正式产品中，这里将保留字段的实际来源和核实状态。</p></section>
      </div><aside class="assessment" aria-label="示例简历覆盖说明"><div class="assessment-heading"><h2>覆盖分 · 示例</h2><p class="assessment-score">${escape(job.score)}<small>/ 100</small></p></div><p class="cell-primary">${escape(data.resume.version)}</p><h3>演示已覆盖技能</h3><p class="skill-line">${job.skills.map(escape).join(' <span aria-hidden="true"> / </span> ')}</p><h3>演示待核实技能</h3><p class="skill-line"><em>${job.missing.length ? job.missing.map(escape).join(' / ') : '本例未列出'}</em></p><p class="assessment-note">固定示例分数，不是对本人简历的评估；关键词覆盖也不等于符合资格。</p><div class="review-callout"><p>下一步：查看一页排版占位与示例原句对照。</p><button type="button" class="button primary" data-action="review" data-id="${escape(job.id)}">审阅示例材料 <span aria-hidden="true">→</span></button></div></aside></div>`;
  }

  function getDraft() {
    if (!drafts.has(selectedId)) drafts.set(selectedId, { text: originalText, previewText: originalText, previewCurrent: true, choice: 'original', confirmed: false, wasSaved: false });
    return drafts.get(selectedId);
  }

  function renderReview() {
    const job = findJob(selectedId);
    if (!job) return;
    const draft = getDraft();
    document.getElementById('review-screen').innerHTML = `
      <button type="button" class="back-button" data-action="back-detail">← 返回职位详情</button>
      <div class="review-heading"><p class="eyebrow">03 / MATERIAL REVIEW</p><h1 id="review-title">审阅材料</h1><p class="intro">${escape(job.company)} · ${escape(job.title)}<br>合成简历与编辑演示；本页保留不会创建文件或改变申请状态。</p></div>
      <div class="review-layout"><div class="paper-column"><div class="paper-topline"><span>一页排版占位</span><span>${escape(data.resume.version)}</span></div><article class="paper" aria-label="示例简历排版预览"><p class="paper-label">排版占位，不改变实际模板</p><h2 class="resume-name">${escape(data.resume.name)}</h2><p class="resume-caption">Fictional resume · ${escape(data.resume.track)}<br>示例人物与内容，非本人简历</p><h3 class="resume-heading">EDUCATION</h3><p>Example University<br>Computer Science · 示例教育占位</p><h3 class="resume-heading">PROJECT EXPERIENCE</h3><p><strong>Selected project · 示例项目</strong></p><div id="resume-preview-text" class="resume-preview-text"></div><h3 class="resume-heading">TECHNICAL SKILLS</h3><p>Python · SQL · JavaScript<br>仅用于展示字体和层次的合成技能</p><p class="paper-end">本预览是 HTML 占位，未进行实际 DOCX / PDF 一页检查。</p></article></div>
      <section class="review-controls" aria-label="修改对照与文字预览"><div class="comparison-head"><h2>原句与建议顺序</h2><span>01 — 02</span></div><div class="comparison-block"><h3>原句 · 合成简历中的顺序</h3><ol>${data.resume.bullets.map((bullet) => `<li>${escape(bullet)}</li>`).join('')}</ol></div><div class="comparison-block"><h3>建议顺序 · 原句交换演示</h3><ol>${suggestedBullets.map((bullet) => `<li>${escape(bullet)}</li>`).join('')}</ol></div><p class="review-notice">这里只演示整组重排的审阅方式；未运行模型，也未根据真实 JD 提出建议。</p><div class="choice-row" role="group" aria-label="选择示例句子顺序"><label><input type="radio" name="review-choice" value="original" ${draft.choice === 'original' ? 'checked' : ''}>保留原文顺序</label><label><input type="radio" name="review-choice" value="suggested" ${draft.choice === 'suggested' ? 'checked' : ''}>采用示例排序</label></div><label for="review-editor" class="editor-label">手动修改并预览</label><textarea id="review-editor" class="review-editor" maxlength="2400" spellcheck="false" aria-describedby="editor-help"></textarea><div class="editor-meta"><p id="editor-help">仅更改示例项目正文，输入内容未核实。</p><span id="character-count"></span></div><div class="button-row"><button type="button" class="button" data-action="update-preview">更新示例预览</button><button type="button" class="text-button" data-action="restore-review">恢复示例原文</button></div><label class="confirm-row"><input type="checkbox" id="review-confirm">我已核对当前示例预览</label><button type="button" class="button accent" data-action="save-review" disabled>在本页保留修改 <span aria-hidden="true">→</span></button><p class="review-feedback" id="review-feedback" role="status">${!draft.previewCurrent ? '文本有改动，请先更新示例预览。' : draft.wasSaved ? '上次修改已在本页保留；刷新后恢复。' : '修改后先更新预览，再核对并保留。'}</p></section></div>`;
    document.getElementById('review-editor').value = draft.text;
    updatePreview();
  }

  function updatePreview() {
    const draft = getDraft();
    document.getElementById('resume-preview-text').textContent = draft.previewText;
    updateReviewControls();
  }

  function updateReviewControls() {
    const draft = getDraft();
    document.getElementById('character-count').textContent = `${draft.text.length} / 2400`;
    const canConfirm = draft.previewCurrent && Boolean(draft.text.trim());
    const confirmation = document.getElementById('review-confirm');
    confirmation.disabled = !canConfirm;
    confirmation.checked = draft.confirmed;
    document.querySelector('[data-action="save-review"]').disabled = !canConfirm || !draft.confirmed;
  }

  function resetFilters() {
    document.getElementById('filter-form').reset();
    document.getElementById('sort-filter').value = 'score';
    renderList();
  }

  document.getElementById('filter-form').addEventListener('submit', (event) => event.preventDefault());
  document.getElementById('filter-form').addEventListener('input', renderList);
  document.getElementById('filter-form').addEventListener('reset', () => { setTimeout(renderList, 0); });
  document.getElementById('sort-filter').addEventListener('change', renderList);

  document.addEventListener('input', (event) => {
    if (event.target.id !== 'review-editor') return;
    const draft = getDraft();
    draft.text = event.target.value;
    draft.choice = 'manual';
    draft.previewCurrent = false;
    draft.confirmed = false;
    draft.wasSaved = false;
    document.querySelectorAll('[name="review-choice"]').forEach((radio) => { radio.checked = false; });
    document.getElementById('review-feedback').textContent = '文本有改动，请先更新示例预览。';
    updateReviewControls();
  });

  document.addEventListener('change', (event) => {
    if (event.target.id === 'review-confirm') {
      const draft = getDraft();
      draft.confirmed = draft.previewCurrent && Boolean(draft.text.trim()) && event.target.checked;
      updateReviewControls();
      return;
    }
    if (event.target.name !== 'review-choice') return;
    const draft = getDraft();
    draft.choice = event.target.value;
    draft.text = draft.choice === 'original' ? originalText : suggestedBullets.join('\n\n');
    draft.previewCurrent = false;
    draft.confirmed = false;
    draft.wasSaved = false;
    document.getElementById('review-editor').value = draft.text;
    document.getElementById('review-feedback').textContent = '已调整示例顺序，请先更新示例预览。';
    updateReviewControls();
  });

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    if (action === 'discover' || action === 'saved' || action === 'back-list') {
      if (action !== 'back-list') {
        scope = action;
        listScroll = 0;
        listJobId = null;
      }
      renderList();
      showScreen('discovery', action === 'back-list');
    } else if (action === 'detail' || action === 'back-detail') {
      if (action === 'detail') {
        if (screen === 'discovery') {
          listScroll = window.scrollY;
          listJobId = button.dataset.id;
        }
        selectedId = button.dataset.id;
      }
      renderDetail();
      showScreen('detail');
    } else if (action === 'review') {
      selectedId = button.dataset.id;
      renderReview();
      showScreen('review');
    } else if (action === 'save') {
      const id = button.dataset.id;
      const wasSaved = saved.has(id);
      if (wasSaved) saved.delete(id);
      else saved.add(id);
      renderList();
      if (screen === 'detail') renderDetail();
      notify(wasSaved ? '已撤销本页保存。正式 Queue 未改变。' : '已保存到本页示例 Queue；刷新后恢复。');
      const nextButton = screen === 'detail' ? document.querySelector('#detail-screen [data-action="save"]') : [...list.querySelectorAll('[data-action="save"]')].find((item) => item.dataset.id === id);
      if (nextButton) nextButton.focus({ preventScroll: true });
      else document.getElementById('main').focus({ preventScroll: true });
    } else if (action === 'reset') {
      resetFilters();
    } else if (action === 'update-preview') {
      const draft = getDraft();
      draft.previewText = draft.text;
      draft.previewCurrent = true;
      draft.confirmed = false;
      updatePreview();
      document.getElementById('review-feedback').textContent = draft.text.trim() ? '示例预览已更新，请核对后勾选确认。' : '请填写示例正文后再预览与确认。';
    } else if (action === 'save-review') {
      const draft = getDraft();
      if (!draft.previewCurrent || !draft.confirmed || !draft.text.trim()) return;
      draft.wasSaved = true;
      document.getElementById('review-feedback').textContent = '示例文字已在本页保留；刷新后恢复。未生成文件或更新正式材料。';
      notify('已在本页保留示例文字。');
    } else if (action === 'restore-review') {
      drafts.set(selectedId, { text: originalText, previewText: originalText, previewCurrent: true, choice: 'original', confirmed: false, wasSaved: false });
      renderReview();
      document.getElementById('review-feedback').textContent = '已恢复合成示例原文。';
      document.getElementById('review-editor').focus({ preventScroll: true });
    }
  });

  renderList();
})();
