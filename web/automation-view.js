const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const date = value => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'America/Toronto', hour12: false }) : '—';
const states = { running: '正在搜索', done: '已完成', partial: '部分来源不完整', failed: '失败', interrupted: '已中断' };
function backgroundDetails(schedule) {
  const now = Date.now();
  const serviceNames = { dashboard: '网页服务', gateway: '调度后台' };
  const serviceStates = { ready: '已就绪（最近记录）', starting: '正在启动', unavailable: '待核实', unknown: '待核实' };
  const reasons = { 'port-unverified': '端口有响应，但服务身份未通过核实；请检查占用程序，避免重复启动。',
    'process-exited': '进程已退出，后台会再次检查并尝试恢复。', 'launch-failed': '启动失败；请检查项目后台日志后再试。' };
  const help = schedule.connected ? '日程核查成功；服务记录用于排查后台运行，不代表岗位搜索已完成。'
    : schedule.state === 'unconfigured' ? '尚未配置日程；请先完成本机后台配置。'
    : schedule.state === 'starting' ? '请等待后台启动，页面会自动重新核查。'
    : '等待下一次检查；如持续无法连接，请手动启动项目后台后刷新。';
  return `<details class="automation-diagnostics"><summary>后台检查详情</summary><p>最近日程核查：${esc(date(schedule.checkedAt))} · 多伦多时间</p><p>${help}</p><ul>${Object.entries(serviceNames).map(([name, label]) => {
    const record = schedule.background?.[name];
    const validTime = Number.isFinite(record?.checkedAt) && record.checkedAt > 0;
    const stale = record?.stale !== false || !validTime || now - record.checkedAt < 0 || now - record.checkedAt >= 90000;
    const state = !validTime ? '尚无有效记录' : stale ? '记录已过期，当前待核实' : serviceStates[record.state] || '待核实';
    return `<li><strong>${label}：${state}</strong>${validTime ? `<span>最近记录：${esc(date(record.checkedAt))}</span>` : ''}${!stale && reasons[record.reason] ? `<span>${reasons[record.reason]}</span>` : ''}</li>`;
  }).join('')}</ul><p>超过 90 秒的记录不作为当前健康依据；未核实的进程不会被自动结束。</p></details>`;
}
export function automationView(info) {
  if (info.demo) return '';
  const schedule = info.schedule || {}, latest = info.runs?.[0];
  const lastResult = info.runs?.find(run => ['done', 'partial'].includes(run.status));
  const verified = schedule.connected && typeof schedule.enabled === 'boolean';
  const label = schedule.state === 'unconfigured' ? '尚未配置自动发现' : schedule.state === 'starting' ? '后台正在启动' : !verified ? '后台连接待核实' : info.broken ? '自动运行受阻' : schedule.enabled ? '每日自动发现已启用' : '自动发现已暂停';
  const running = latest?.status === 'running';
  const next = !verified ? '连接恢复后确认' : info.broken ? '请先检查运行记录' : running ? latest.catchUp ? '正在当天补跑' : '正在搜索' : !schedule.enabled ? '恢复后按计划执行' : info.waiting ? info.retryAt ? '等待重试 / 网络恢复' : '自动重试已停止' : info.due ? '等待当天补跑' : date(info.nextScheduledAt);
  return `<div class="automation-summary"><div><span class="eyebrow">DAILY DISCOVERY</span><h2>${label}</h2><p>每天 09:00 · 多伦多时间</p></div><div class="automation-next"><span>${running ? '当前进度' : info.due ? '当天任务' : '下次计划'}</span><strong>${esc(next)}</strong><small>${running && verified && !schedule.enabled ? '当前搜索继续完成；暂停后不再自动启动' : '每分钟仅检查是否到期，不会每分钟搜索'}</small></div><div class="form-actions"><button class="button secondary compact" data-action="automation-toggle" ${!verified ? 'disabled' : ''}>${!verified ? '日程待核实' : schedule.enabled ? '暂停' : '恢复自动运行'}</button><button class="button secondary compact" data-action="search">立即搜索</button></div></div>
    ${lastResult ? `<p class="automation-last-result">上次完成搜索：${esc(date(lastResult.finishedAt))}${lastResult.status === 'partial' ? ' · 部分来源失败，结果不完整' : ''}${latest?.status === 'failed' || latest?.status === 'interrupted' ? ' · 已保留这次结果' : ''}</p>` : ''}
    ${schedule.error || info.waiting ? `<p class="automation-warning" role="status">${esc(info.waiting || schedule.error)}${info.retryAt ? ` · 再检查：${esc(date(info.retryAt))}` : ''}</p>` : ''}
    ${backgroundDetails(schedule)}
    ${latest ? `<details class="automation-history"><summary>最近：${esc(states[latest.status] || latest.status)} · ${esc(date(latest.startedAt))}${latest.catchUp ? ' · 补跑' : ''}${latest.count != null ? ` · ${latest.count} 条 / ${latest.added == null ? '首次基线' : `新增 ${latest.added} 条`}` : ''}</summary><p>新增指相对上次完成的搜索快照。时间均为多伦多当地时间。</p><div class="automation-runs">${info.runs.slice(0, 10).map(run => `<article><strong>${esc(states[run.status] || run.status)} · ${run.trigger === 'manual' ? '手动' : run.catchUp ? '当天补跑' : '定时'}</strong><p>计划 ${esc(date(run.scheduledAt))} · 开始 ${esc(date(run.startedAt))} · 完成 ${esc(date(run.finishedAt))}</p><p>${run.count == null ? '' : `${run.count} 条 · ${run.review || 0} 条待核实 · ${run.added == null ? '首次基线' : `新增 ${run.added} 条`}`}${esc(run.error || (run.errors || []).join('；'))}</p><small>运行编号 ${esc(run.id)}</small></article>`).join('')}</div></details>` : '<p class="automation-empty">尚无运行记录。结果仅在此 Dashboard 显示。</p>'}`;
}
