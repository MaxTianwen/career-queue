// Only explicit application instructions establish required channels.
export function schoolRequirement(rows = [], job = {}) {
  const evidence = [];
  const decisions = [];
  for (const row of [...rows, job]) {
    for (const text of [
      row.applicationInstructions,
      row.applicationMethod,
      row.instructions,
      row.jd,
      row.description
    ].filter(v => typeof v === 'string')) {
      for (const line of text
        .split(/\n|(?<=[.!?])\s+/)
        .map(s => s.trim())
        .filter(Boolean)) {
        const portal = /(?:co.?op|school|university|学校|校内).{0,25}(?:portal|系统|平台)|\bportal\b/i.test(line);
        const website =
          /(?:company|employer|corporate).{0,25}(?:website|site)|external.{0,15}(?:application|website)|官网/i.test(
            line
          );
        const apply = /apply|submit|application|申请|投递|提交/i.test(line);
        const negative = /\bnot\b|don't|\bmay\b|\bcan\b|optional|无需|不需要|可选/i.test(line);
        if (
          portal &&
          apply &&
          !negative &&
          /(?:apply|submit).{0,16}(?:only|exclusively).{0,40}portal|(?:only|exclusively).{0,8}(?:apply|submit).{0,40}portal|portal.{0,8}only|仅.{0,12}(?:学校|校内|portal)|只需.{0,12}(?:学校|portal)/i.test(
            line
          ) &&
          !website
        ) {
          decisions.push('portal_only');
          evidence.push(line);
        } else if (
          portal &&
          website &&
          apply &&
          !negative &&
          /\bboth\b|\bmust\b|\brequired\b|必须|同时|均需/i.test(line)
        ) {
          decisions.push('both');
          evidence.push(line);
        }
      }
    }
  }
  const unique = [...new Set(decisions)];
  return {
    kind: unique.length === 1 ? unique[0] : 'unknown',
    evidence: [...new Set(evidence)],
    conflict: unique.length > 1
  };
}
export function channelProgress(channel, submissions = []) {
  const portal = submissions.some(s => s.channel === 'school' && !s.withdrawn),
    employer = submissions.some(s => s.channel === 'employer' && !s.withdrawn);
  return {
    portal: portal ? '已提交' : '待提交',
    employer: employer ? '已提交' : channel === 'both' ? '待提交' : channel === 'school-only' ? '无需提交' : '待确认',
    missing:
      channel === 'both'
        ? [...(!portal ? ['school'] : []), ...(!employer ? ['employer'] : [])]
        : channel === 'school-only' && !portal
          ? ['school']
          : [],
    requirement:
      channel === 'both' ? '学校 Portal + 官网' : channel === 'school-only' ? '仅学校 Portal' : '申请途径待确认'
  };
}
