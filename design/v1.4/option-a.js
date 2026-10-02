(() => {
  const {jobs,resume}=window.CQ_DEMO;
  const $=s=>document.querySelector(s);
  const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const trackName={cs:'CS',data:'Data',mixed:'CS / Data'}, modeName={hybrid:'Hybrid · 混合',onsite:'On-site · 现场',remote:'Remote · 远程'};
  let view='discover',selected=jobs[0].id,tab='job',toastTimer;
  const saved=new Set(), drafts=new Map(), confirmed=new Set();
  const controls=['keyword','season','track','region','mode','duration','sort'];
  function filtered(){return jobs.filter(j=> (view!=='queue'||saved.has(j.id)) && (!$('#keyword').value||`${j.company} ${j.title} ${j.city}`.toLowerCase().includes($('#keyword').value.toLowerCase())) && (!$('#season').value||j.season===$('#season').value) && (!$('#track').value||j.track===$('#track').value) && (!$('#region').value||($('#region').value==='toronto'?/Toronto|North York/.test(j.city):j.region===$('#region').value)) && (!$('#mode').value||j.mode===$('#mode').value) && (!$('#duration').value||j.duration===Number($('#duration').value))).sort((a,b)=>$('#sort').value==='date'?b.posted.localeCompare(a.posted)||b.score-a.score:b.score-a.score);}
  function toast(text){clearTimeout(toastTimer);$('#toast').textContent=text;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,4500);}
  function highlight(text,j){let html=esc(text);for(const skill of j.skills){const pattern=skill.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');html=html.replace(new RegExp(`\\b${pattern}\\b`,'g'),m=>`<mark>${m}</mark>`);}return html;}
  function render(){
    const rows=filtered();if(!rows.some(j=>j.id===selected)){selected=rows[0]?.id;tab='job';}
    $('#workspace').classList.toggle('reviewing',tab==='review');document.body.classList.toggle('review-mode',tab==='review');$('#page-name').innerHTML=`${view==='queue'?'已保存职位':'发现职位'}<span class="title-dot">.</span>`;
    $('#saved-count').textContent=saved.size;$('#result-count').textContent=`${rows.length} 个示例岗位`;$('#list-title').textContent=view==='queue'?'我的 Queue':'所有机会';
    document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===view);b.setAttribute('aria-pressed',String(b.dataset.view===view));});
    $('#filter-summary').textContent=controls.filter(id=>id!=='sort'&&$('#'+id).value).map(id=>id==='keyword'?`搜索：${$('#'+id).value}`:$('#'+id).selectedOptions[0].textContent).join('  /  ');
    $('#job-list').innerHTML=rows.length?rows.map(j=>`<button class="job-row ${j.id===selected?'selected':''}" data-job="${j.id}" aria-pressed="${j.id===selected}"><span class="row-top"><span class="monogram">${j.company[0]}</span>${j.company}<span style="margin-left:auto">${trackName[j.track]}</span></span><h3>${j.title}</h3><p class="row-facts">${j.city} · ${modeName[j.mode].split(' · ')[0]}<br>${j.season} · ${j.duration} 个月</p><span class="row-bottom"><span class="row-score"><b>${j.score}</b> 匹配示例</span>${saved.has(j.id)?'<span class="row-saved">已保存 ✓</span>':`<span>${j.posted.slice(5).replace('-','/')} 发布</span>`}</span></button>`).join(''):'<div class="empty">没有符合条件的示例岗位。<br>可清空筛选，或在发现页保存一份职位。</div>';
    renderReader();
  }
  function renderReader(){
    const j=jobs.find(j=>j.id===selected);if(!j){$('#reader').innerHTML='<div class="empty">选择职位后，在这里查看详情和材料。</div>';return;}
    const isSaved=saved.has(j.id);
    $('#reader').innerHTML=`<button class="back-mobile" data-action="back">← 返回职位列表</button><div class="detail-company"><span class="company-lockup"><span class="monogram">${j.company[0]}</span>${j.company}</span><span class="direction">${trackName[j.track]}</span></div><h2>${j.title}</h2><p class="detail-meta">${j.city} · ${j.posted} 发布 · 示例职位</p><div class="actions"><button class="${isSaved?'secondary saved':'primary'}" data-action="save">${isSaved?'✓ 已保存 · 点击撤销':'＋ 保存到 Queue'}</button><button class="secondary" data-action="review">查看材料审阅示例 →</button></div><div class="tabs" aria-label="职位内容"><button class="${tab==='job'?'active':''}" data-tab="job" aria-pressed="${tab==='job'}">职位详情</button><button class="${tab==='review'?'active':''}" data-tab="review" aria-pressed="${tab==='review'}">材料审阅${confirmed.has(j.id)?' · 已确认示例':''}</button></div>${tab==='review'?review(j):jobDetail(j)}`;
  }
  function jobDetail(j){return `<dl class="fact-grid"><div><dt>入职时间</dt><dd>${j.season}</dd></div><div><dt>工作时长</dt><dd>${j.duration} 个月</dd></div><div><dt>工作地点</dt><dd>${j.city}</dd></div><div><dt>工作方式</dt><dd>${modeName[j.mode]}</dd></div><div><dt>薪资</dt><dd>${j.salary}</dd></div><div><dt>申请截止</dt><dd>${j.deadline}</dd></div></dl><section class="fit-box"><div class="fit-top"><div><h3>与你的简历相匹配</h3><p>当前 CS · v4（示例） · 非录取概率</p></div><div class="big-score">${j.score}<small> / 100</small></div></div><div class="skills">${j.skills.map(s=>`<span class="skill">✓ ${s}</span>`).join('')}</div><details><summary>查看匹配依据与未体现要求</summary><ul>${j.skills.map(s=>`<li>${s}：用于展示当前简历的对应原句位置。</li>`).join('')}<li>示例简历未体现：${j.missing.join('、')}；未体现不等于不会。</li></ul><p>这里的分数与依据均为设计示例，没有读取你的简历。</p></details></section><section class="body-copy"><h3>关于这个机会</h3><p>${highlight(j.summary,j)}</p><h3>你将用到的能力</h3><ul>${j.requirements.map(r=>`<li>${highlight(r,j)}</li>`).join('')}</ul></section><div class="deadline">高亮内容对应示例匹配技能 · 招聘公司与 JD 均为虚构</div>`;}
  function review(j){const bullets=drafts.get(j.id)||resume.bullets;return `<div class="review-grid"><section class="paper-bed" aria-label="简历版式占位"><p class="paper-note">一页简历预览区域 · 排版占位<br>正式版沿用你的原模板，设计稿不改变字体与版式。</p><article class="paper"><h3>${resume.name}</h3><p class="contact">Toronto, ON · Demo resume · Not for application</p><h4>PROFILE</h4><p>Computer science student interested in building useful software and working with data.</p><h4>SKILLS</h4><p>Python · SQL · React · JavaScript · Git</p><h4>SELECTED PROJECTS</h4><p><b>Data Explorer — Sample Project</b></p><ul id="preview-bullets">${bullets.map(b=>`<li>${esc(b)}</li>`).join('')}</ul><h4>EDUCATION</h4><p>Example University<br>Computer Science · Sample information</p><div class="placeholder-lines">Fictional content for interface evaluation only.<br>Actual page count and formatting are not validated in this concept.</div></article></section><section class="review-tools"><p class="eyebrow">REVIEW BEFORE YOU APPLY</p><h3>保留事实，调整表达。</h3><p>为 ${j.company} 审阅材料。原句、编辑内容与预览在同一处，不需要下载后再上传。</p><label>来源原句<div class="original">${esc(resume.bullets[0])}</div></label><label for="edit-bullet">手动编辑 · 示例项目要点<textarea id="edit-bullet" maxlength="350">${esc(bullets[0])}</textarea></label><button class="secondary" data-action="preview">更新本页预览</button><p class="review-foot">仅演示手动编辑。未接入模型，也不生成 DOCX / PDF。</p><label class="review-check"><input type="checkbox" id="checked">我已核对示例文字，体验材料确认操作。</label><div class="actions"><button class="primary" id="confirm-material" data-action="confirm" disabled>确认这份示例材料</button><button class="text-button" data-tab="job">返回职位详情</button></div><p id="review-message" class="review-message" role="status">${confirmed.has(j.id)?'此示例已在本页确认；真实材料与申请状态未改变。':''}</p></section></div>`;}
  controls.forEach(id=>$('#'+id).addEventListener(id==='keyword'?'input':'change',()=>{tab='job';render();}));
  $('#clear').addEventListener('click',()=>{controls.filter(id=>id!=='sort').forEach(id=>$('#'+id).value='');tab='job';render();});
  document.addEventListener('click',event=>{
    const b=event.target.closest('button');if(!b)return;
    if(b.dataset.view){view=b.dataset.view;tab='job';document.body.classList.remove('mobile-detail');render();}
    if(b.dataset.job){selected=b.dataset.job;tab='job';document.body.classList.add('mobile-detail');render();$('#reader').scrollTop=0;if(matchMedia('(max-width:700px)').matches)$('#reader').scrollIntoView({block:'start'});}
    if(b.dataset.tab||b.dataset.action==='review'){tab=b.dataset.tab||'review';render();}
    if(b.dataset.action==='back'){tab='job';document.body.classList.remove('mobile-detail');render();$(`[data-job="${selected}"]`)?.focus();}
    if(b.dataset.action==='save'){const removing=saved.has(selected);if(removing)saved.delete(selected);else saved.add(selected);render();toast(removing?'已撤销示例保存，正式 Queue 未改变。':'已保存到本页示例 Queue；可点左侧“已保存”查看。');}
    if(b.dataset.action==='preview'){
      const text=$('#edit-bullet').value.trim();if(!text){toast('请先填写示例要点。');$('#edit-bullet').focus();return;}
      drafts.set(selected,[text,resume.bullets[1]]);confirmed.delete(selected);
      $('#preview-bullets').innerHTML=drafts.get(selected).map(line=>`<li>${esc(line)}</li>`).join('');$('#checked').checked=false;$('#confirm-material').disabled=true;$('#review-message').textContent='本页预览已更新。文字改动后需重新确认。';
    }
    if(b.dataset.action==='confirm'&&$('#checked')?.checked){confirmed.add(selected);$('#review-message').textContent='示例材料已在本页确认。没有生成文件、写入 Notion 或提交申请。';}
  });
  document.addEventListener('input',event=>{if(event.target.id==='edit-bullet'){confirmed.delete(selected);$('#checked').checked=false;$('#confirm-material').disabled=true;$('#review-message').textContent='文字已修改，请更新预览后重新核对。';}});
  document.addEventListener('change',event=>{if(event.target.id==='checked'){
    const applied=(drafts.get(selected)||resume.bullets)[0];const same=$('#edit-bullet').value.trim()===applied;
    if(event.target.checked&&!same){event.target.checked=false;toast('请先更新预览，再核对确认。');}
    $('#confirm-material').disabled=!event.target.checked;
  }});
  render();
})();
