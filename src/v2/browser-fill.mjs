import { randomBytes, createHash } from 'node:crypto';
import { fail } from './store.mjs';
import { rehearsalFields } from './fill-rehearsal.mjs';

export function greenhouseTarget(value) {
  let u;
  try {
    u = new URL(value);
  } catch {
    fail(400, '请打开 Greenhouse 官方岗位页');
  }
  if (
    u.protocol !== 'https:' ||
    u.port ||
    u.username ||
    u.password ||
    !['boards.greenhouse.io', 'job-boards.greenhouse.io'].includes(u.hostname) ||
    !/^\/[a-z0-9_-]{1,100}\/jobs\/\d{1,20}\/?$/i.test(u.pathname)
  )
    fail(400, '只支持 Greenhouse 官方岗位页');
  return 'https://job-boards.greenhouse.io' + u.pathname.replace(/\/$/, '');
}
export function browserFillBridge(store) {
  const grants = new Map(),
    hash = value => createHash('sha256').update(value).digest('hex');
  function plan(owner, id) {
    const current = store.questionDraft(owner, id);
    if (!current.draft || current.stale) fail(409, '请先保存并核对逐题草稿');
    const targetUrl = greenhouseTarget(store.job(owner, id).url);
    const path = new URL(targetUrl).pathname;
    if (current.draft.form.source !== 'https://boards-api.greenhouse.io/v1/boards' + path + '?questions=true')
      fail(409, '问题来源与岗位链接不一致，请重新读取');
    const result = rehearsalFields(current.draft);
    // Real hosted forms couple telephone input to a country selector.
    const fields = result.fields.filter(f => f.label.trim().toLowerCase() !== 'phone');
    const manual = [
      ...result.manual,
      ...result.fields
        .filter(f => f.label.trim().toLowerCase() === 'phone')
        .map(f => ({ label: f.label, reason: '电话与国家选择器由本人处理' }))
    ];
    if (!fields.length) fail(409, '暂无已选且可用于普通文本填写的答案');
    const value = { targetUrl, revision: current.revision, basis: current.basis, fields, manual };
    return { ...value, fingerprint: hash(JSON.stringify(value)) };
  }
  return {
    issue(owner, id, sessionToken, input) {
      if (input.confirmed !== true) fail(400, '请确认生成本次浏览器配对码');
      const current = plan(owner, id);
      if (input.revision !== current.revision || input.basis !== current.basis) fail(409, '草稿已变化，请刷新');
      for (const [key, g] of grants) if (g.expires <= store.now() || g.owner === owner) grants.delete(key);
      if (grants.size >= 32) fail(429, '临时连接已满，请稍后重试');
      const code = randomBytes(32).toString('hex'),
        expires = store.now() + 3 * 60 * 1000;
      grants.set(hash(code), { owner, id, sessionToken, expires, fingerprint: current.fingerprint });
      return { code, expires, targetUrl: current.targetUrl };
    },
    use(code, input, confirm = false) {
      if (!/^[a-f0-9]{64}$/.test(code ?? '')) fail(403, '配对码无效');
      const key = hash(code),
        grant = grants.get(key);
      if (!grant || grant.expires <= store.now() || store.session(grant.sessionToken)?.id !== grant.owner) {
        grants.delete(key);
        fail(403, '配对码已失效，请在 Dashboard 重新生成');
      }
      const current = plan(grant.owner, grant.id);
      if (greenhouseTarget(input.targetUrl) !== current.targetUrl || current.fingerprint !== grant.fingerprint)
        fail(409, '页面或草稿已变化，请重新配对');
      if (confirm) {
        if (input.confirmed !== true || input.fingerprint !== current.fingerprint)
          fail(409, '请重新预览并确认本次填写');
        grants.delete(key);
      }
      return { ...current, expires: grant.expires };
    }
  };
}
