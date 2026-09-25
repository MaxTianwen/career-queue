// Local keyword evidence coverage, not an ATS score or a hiring probability.
// Read only the supported skill rows in knowledge-base section 5, never its search terms or prohibitions.
const skills = [
  ['Python', /\bpython\b/i], ['SQL', /\bsql\b/i], ['MySQL', /\bmysql\b/i], ['PostgreSQL', /\bpostgres(?:ql)?\b/i],
  ['Excel', /\bexcel\b/i], ['Tableau', /\btableau\b/i], ['Power BI', /\bpower\s*bi\b/i], ['pandas', /\bpandas\b/i], ['NumPy', /\bnumpy\b/i],
  ['C++', /\bc\+\+(?!\w)/i], ['C', /\bc\b(?![+#])/i], ['JavaScript', /\bjavascript\b/i], ['Node.js', /\bnode(?:\.js|js)?\b/i],
  ['Express', /\bexpress(?:\.js|js)?\b/i], ['EJS', /\bejs\b/i], ['HTML', /\bhtml5?\b/i], ['CSS', /\bcss3?\b/i],
  ['Git', /\bgit\b/i], ['Jira', /\bjira\b/i], ['React', /\breact(?:\.js|js)?\b/i], ['FastAPI', /\bfastapi\b/i], ['MongoDB', /\bmongodb\b/i],
  ['Java', /\bjava\b/i], ['TypeScript', /\btypescript\b/i], ['C#', /\bc#(?!\w)/i], ['Go', /\b(?:golang|go programming|go language)\b|\bGo(?=\s*[,/])/],
  ['AWS', /\baws\b|amazon web services/i], ['Azure', /\bazure\b/i], ['GCP', /\bgcp\b|google cloud/i], ['Docker', /\bdocker\b/i],
  ['Kubernetes', /\bkubernetes\b|\bk8s\b/i], ['Linux', /\blinux\b/i], ['CI/CD', /\bci\s*\/\s*cd\b|continuous (?:integration|delivery)/i],
  ['Spark', /\b(?:apache )?spark\b/i], ['Snowflake', /\bsnowflake\b/i], ['TensorFlow', /\btensorflow\b/i], ['PyTorch', /\bpytorch\b/i],
  ['R', /\bR(?=\s*[,/])|\bR programming\b/], ['SAS', /\bsas\b/i], ['Power Query', /\bpower query\b/i], ['VBA', /\bvba\b/i],
  ['SQL Server', /\bsql server\b|\bmssql\b/i], ['Spring', /\bspring (?:mvc|boot|security|framework)\b/i], ['Hibernate', /\bhibernate\b/i],
  ['JUnit', /\bjunit\b/i], ['Confluence', /\bconfluence\b/i], ['OAuth', /\boauth\b/i], ['J2EE/JEE', /\bj2ee\b|\bjee\b/i],
  ['Power Platform', /\bpower (?:platform|apps|automate)\b/i], ['REST API', /\brest(?:ful)? api/i],
  ['LLM', /\bllms?\b|large language model/i], ['LangChain', /\blangchain\b/i], ['RAG', /\brag\b|retrieval.augmented generation/i]
];
const experiences = [
  ['数据分析', /data analy(?:sis|tics)|business analy(?:sis|tics)|数据分析|销售\/KPI 分析/i, /工作数据分析/],
  ['数据清洗与标准化', /data (?:cleaning|cleansing|preparation|quality)|数据标准化|清洗/i, /工作数据分析|工作技术/],
  ['业务报表与看板', /dashboard|reporting|business intelligence|数据看板|报告/i, /工作数据分析|工作技术/],
  ['市场与业务分析', /market research|competitive analysis|market analysis|市场研究|竞争对手分析/i, /工作数据分析/],
  ['跨团队协作', /cross.functional|stakeholder|collaborat|跨部门沟通/i, /工作数据分析|测试与协作/],
  ['Web 应用项目', /web (?:application|development)|full.stack|back.end|front.end|web 项目|crud/i, /Web 项目/],
  ['C/C++ 与面向对象项目', /object.oriented|\boop\b|\bstl\b|memory management|面向对象|资源管理/i, /C\/C\+\+/],
  ['测试与版本协作', /unit test|regression test|software test|version control|测试|\bgit\b/i, /测试与协作|当前 CMS/],
  ['机器学习研发', /machine learning|model training|deep learning|机器学习研发/i, /无已确认行/],
  ['云平台运维', /site reliability|production incident|on.call|cloud infrastructure/i, /无已确认行/]
];

export function buildProfile(knowledge = '') {
  const section = knowledge.match(/## 5\. 技能与证据范围\s*([\s\S]*?)(?=\n## |$)/)?.[1] || '';
  const rows = section.split('\n').filter(l => l.startsWith('|')).map(line => {
    const [, group, content, evidence] = line.split('|').map(x => x.trim());
    return { group, content: content || '', evidence: evidence || '' };
  });
  const supported = rows.filter(r => /^(工作数据分析|工作技术|C\/C\+\+|Web 项目|测试与协作|当前 CMS 的其他接触)$/.test(r.group));
  const resumeOnly = rows.find(r => r.group === '仅原简历列出、具体案例未展开')?.content || '';
  const technical = skills.map(([name, pattern]) => {
    const row = supported.find(r => pattern.test(r.content) || ['C', 'C++'].includes(name) && r.group === 'C/C++' || name === 'Python' && r.group === '工作技术' && /Python/.test(r.evidence));
    const basic = name === 'Power BI' && supported.find(r => /Power BI.*basic/i.test(r.evidence));
    return { name, pattern, level: basic ? 0.5 : row ? 1 : 0, unverified: pattern.test(resumeOnly), evidence: basic ? basic.evidence : row?.evidence };
  });
  return { available: supported.length > 0, technical, experience: experiences.map(([name, pattern, group]) => ({ name, pattern,
    level: supported.some(r => group.test(r.group)) ? 1 : 0, evidence: supported.filter(r => group.test(r.group)).map(r => r.evidence).join('；') })) };
}

export function matchJob(job, profile) {
  if (!job.jd?.trim() || job.fullJd === false) return { score: null, reason: '待补完整 JD，暂不评分' };
  if (!profile.available) return { score: null, reason: '知识库技能证据不可用，暂不评分' };
  const qualifications = job.jd.match(/^(?:[\s#*-]*)(?:qualifications|requirements|what you (?:bring|need)|who you are|about you|let['’]s talk about you)[!:\s]*$([\s\S]*)/im)?.[1];
  const comparedText = qualifications ? qualifications.split(/\n(?:what we offer|benefits|compensation|equity, diversity|equal opportunity)/i)[0] : job.jd;
  const technical = profile.technical.filter(x => x.pattern.test(comparedText));
  const experience = profile.experience.filter(x => x.pattern.test(comparedText));
  const parts = [{ name: '技能覆盖', weight: 70, rows: technical }, { name: '经历主题覆盖', weight: 30, rows: experience }].filter(p => p.rows.length);
  if (!parts.length) return { score: null, reason: '未识别到可计分要求，请阅读 JD 核实' };
  const weight = parts.reduce((n, p) => n + p.weight, 0);
  const score = Math.round(parts.reduce((n, p) => n + p.weight * p.rows.reduce((sum, r) => sum + r.level, 0) / p.rows.length, 0) / weight * 100);
  const evidence = [...technical.map(item => ({ ...item, kind: 'skill' })), ...experience.map(item => ({ ...item, kind: 'experience' }))]
    .map(({ name, level, evidence, unverified, kind }) => ({ name, level, evidence: evidence || null, unverified: Boolean(unverified), kind }));
  const checks = job.jd.split(/\n|(?<=[.!?])\s+/).filter(l => /\b(?:\d+\+?\s*(?:years?|yrs?)|citizen|citizenship|security clearance|return(?:ing)? to school|enroll|degree|graduat)\b/i.test(l)).slice(0, 6).map(l => l.trim().slice(0, 350));
  return { score, version: '本地规则 v1', evidenceCount: evidence.length, comparedSection: qualifications ? 'JD 资格要求段落' : 'JD 全文（未识别独立资格段落）',
    components: parts.map(p => ({ name: p.name, weight: Math.round(p.weight / weight * 100), matched: p.rows.reduce((n, r) => n + r.level, 0), total: p.rows.length })),
    matched: evidence.filter(x => x.level > 0), gaps: evidence.filter(x => x.level === 0), checks,
    note: '按 JD 提及的技能与经历主题计算覆盖度；基础接触计半项，仅简历列出计待核实。未全面区分必需/加分/任选条件；不表示熟练度、专业年限或录取概率。' };
}
