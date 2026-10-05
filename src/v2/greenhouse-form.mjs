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
  const questions = data.questions.map(q => {
    if (!q || typeof q.required !== 'boolean' || !Array.isArray(q.fields) || !q.fields.length || q.fields.length > 20) throw Error('申请字段结构变化，未导入');
    return { label: text(q.label), required: q.required, fields: q.fields.map(f => {
      if (!f || typeof f.type !== 'string' || f.type.length > 100 || (f.values != null && !Array.isArray(f.values)) || f.values?.length > 200) throw Error('申请选项结构变化，未导入');
      return { type: f.type, options: (f.values || []).map(v => text(v.label)) };
    }) };
  });
  return { title: text(data.title), source, checkedAt: new Date().toISOString(), questions,
    notice: '仅为官方接口返回的主申请问题，不保证涵盖网页全部步骤。地址、同意条款、自愿披露、动态问题及隐藏字段请在官网核对；组合字段可能只需任选一种方式。不会自动填写答案或提交。' };
}
