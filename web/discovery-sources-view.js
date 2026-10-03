const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const table = (heads, rows) => `<div class="source-scroll"><table><thead><tr>${heads.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(v => `<td>${esc(v ?? '无法比较')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

export function discoverySourcesView(report) {
  if (!report.sources?.length) return '<p>旧版搜索快照仅包含公共索引；重新搜索可读取新增雇主来源。</p>';
  const m = report.metrics;
  return `<details class="source-summary"><summary>发现入口 · ${report.sources.length} 个${report.partial ? ' · 部分来源不完整' : ''}</summary><p>本次抓取快照，不随筛选变化。公开索引 + 指定雇主列表，非全部 ATS / 全网搜索。</p>${table(['发现来源', '读取状态', '原始条目', '范围内候选', '异常条目', '页数'], report.sources.map(s => [s.name, { complete: '完整', partial: '部分取得', failed: '失败' }[s.status], s.raw, s.candidates, s.malformed, s.pages]))}${m ? `<p>独立卡片 ${m.independent}；相同链接 / 可靠编号合并 ${m.exact}；同公司标题批次地点归组 ${m.grouped}；身份冲突 ${m.conflicts}。</p><p>${m.baselineComplete ? `相对同次索引：已明确通过全部规则的新增 ${m.incremental}；新增待核实 ${m.pending}。后者可查看，尚不能认定全部要求符合。` : '索引基线不完整，暂不计算相对新增。'}</p>${table(['发现来源', '独立卡片', '共同发现', '新增通过', '新增待核实', '列表自带 JD', '详情成功 / 尝试', '未支持'], m.bySource.map(s => [s.name, s.independent, s.shared, s.incremental, s.pending, s.inline, `${s.succeeded} / ${s.attempted}`, s.unsupported]))}<p>共同发现计入每个相关来源，来源行不可相加为总新增；详情统计按本次候选读取，列表自带正文不计为详情请求成功。</p>${table(['字段取得 / 独立卡片数', '发布', '截止', '薪资', '时长', '方式'], m.bySource.map(s => [s.name, ...['published','deadline','salary','duration','workMode'].map(k => `${s.fields[k]} / ${s.fields.denominator}`)]))}` : ''}</details>`;
}

export function fieldEvidenceView(job) {
  const fields = Object.entries(job.fieldEvidence || {});
  if (!fields.length) return '';
  const labels = { salary: '薪资', duration: '工作时长', workMode: '工作方式' };
  const states = { options: '官网明确可选', extracted: '已提取', ambiguous: '信息不一致，待核实', 'not-extracted': '正文中未提取到确定值，待核实', unread: '正文尚未取得' };
  return `<details class="origin-links"><summary>查看重点字段依据</summary>${fields.map(([key, e]) => `<p><b>${esc(labels[key] || key)}</b> · ${esc(states[e.status] || '待核实')}<br>${esc(e.source)}${e.raw ? `：${esc(e.raw)}` : ''}</p>`).join('')}<p>未提取到不等于官方明确未披露；裸 $ 不推断币种，不补猜缺失计薪周期。</p></details>`;
}
