import { postingText } from '../discovery-sources.mjs';

export async function readGreenhouseForm(url, fetchImpl = fetch) {
  let parsed;
  try { parsed = new URL(url); } catch { throw Error('请先保存 Greenhouse 官方岗位链接'); }
  const match = parsed.pathname.match(/^\/([a-z0-9_-]{1,100})\/jobs\/(\d{1,20})\/?$/i);
  if (parsed.protocol !== 'https:' || parsed.port || parsed.username || parsed.password || !['boards.greenhouse.io', 'job-boards.greenhouse.io'].includes(parsed.hostname) || !match) throw Error('本期仅支持 Greenhouse 官方岗位链接');
  const source = `https://boards-api.greenhouse.io/v1/boards/${match[1]}/jobs/${match[2]}?questions=true`;
  const response = await fetchImpl(source, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json' } });
  if (!response.ok) throw Error(`申请表暂无法读取（HTTP ${response.status}），请到官网核实`);
  let size = 0; const chunks = [];
  for await (const chunk of response.body) { size += chunk.length; if (size > 2000000) throw Error('申请表响应过大，未导入'); chunks.push(chunk); }
  const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (String(data.id) !== match[2] || typeof data.title !== 'string' || !Array.isArray(data.questions) || !data.questions.length || data.questions.length > 100) throw Error('官方申请表结构无法确认，未导入');
  const text = value => { if (typeof value !== 'string' || value.length > 10000) throw Error('申请字段无法识别，未导入'); return postingText(value); };
  const parseQuestions = (items, section) => items.map(q => {
    if (!q || typeof q.required !== 'boolean' || !Array.isArray(q.fields) || !q.fields.length || q.fields.length > 20) throw Error('申请字段结构变化，未导入');
    return { section, label: text(q.label), required: q.required, fields: q.fields.map(f => {
      if (!f || typeof f.type !== 'string' || f.type.length > 100 || (f.values != null && !Array.isArray(f.values)) || f.values?.length > 200) throw Error('申请选项结构变化，未导入');
      return { type: f.type, options: (f.values || []).map(v => text(v.label)) };
    }) };
  });
  const questions = parseQuestions(data.questions, '申请问题');
  const warnings = [];
  for (const [key, section] of [['location_questions', '地址信息'], ['compliance', '合规披露']]) {
    if (data[key] == null) continue;
    if (!Array.isArray(data[key]) || data[key].length > 100) { warnings.push(section + '结构无法识别，请到官网核对'); continue; }
    try {
      const items = key === 'compliance' ? data[key].flatMap(group => Array.isArray(group?.questions) ? group.questions : [group]) : data[key];
      if (items.length > 100) throw Error('too many');
      questions.push(...parseQuestions(items, section));
    }
    catch { warnings.push(section + '结构无法识别，请到官网核对'); }
  }
  if (data.demographic_questions != null) {
    try {
      const items = data.demographic_questions.questions;
      if (!Array.isArray(items) || items.length > 100 || items.some(q => !q || !Array.isArray(q.answer_options))) throw Error('invalid');
      questions.push(...parseQuestions(items.map(q => ({label:q.label, required:q.required, fields:[{type:q.type, values:q.answer_options?.map(v => ({label: text(v.label) + (v.free_form ? '（可补充文字）' : '')}))}]})), '自我披露'));
    } catch { warnings.push('自我披露问题无法完整识别，请到官网核对'); }
  }
  if (data.data_compliance != null && (!Array.isArray(data.data_compliance) || data.data_compliance.length)) warnings.push('官网另有个人资料处理或保留条款，请阅读原文并本人选择是否同意');
  const visible = questions.map(q => ({...q, fields:q.fields.filter(f => f.type !== 'input_hidden')})).filter(q => q.fields.length);
  if (JSON.stringify(visible) !== JSON.stringify(questions)) warnings.push('官网自动处理的隐藏字段未加入草稿，请在官网完成地址等相关步骤');
  return { title: text(data.title), source, checkedAt: new Date().toISOString(), questions: visible, warnings,
    notice: '显示官方接口可识别的问题，不保证涵盖网页全部步骤。必填标记仅按接口原文呈现，不代表已核实申请资格；披露及同意事项请本人在官网决定。组合字段可能只需任选一种方式。不会自动填写答案或提交。' };
}
