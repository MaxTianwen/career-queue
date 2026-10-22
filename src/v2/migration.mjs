import { createHash } from 'node:crypto';
import { fail, textField, FILE_BYTES } from './store.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const digest = value => hash(JSON.stringify(value));

// Deliberately limited to one unsubmitted v1 Queue record and its generated files.
function normalize(bundle) {
  const r = bundle?.record;
  if (
    !r ||
    !/^[a-f0-9]{24}$/.test(r.key ?? '') ||
    r.status !== 'Queue' ||
    r.portal ||
    r.portalHistory?.length ||
    r.externalSubmission ||
    r.applicationDate ||
    r.materials ||
    r.materialVersion ||
    r.attachments?.length
  )
    fail(409, '本期仅支持无学校关联、无审阅材料和无提交历史的 Queue 职位');
  const original = { status: 'Queue' };
  for (const name of ['company', 'title', 'location', 'url', 'notes', 'jd', 'term'])
    original[name] = textField(
      r[name] ?? '',
      name === 'jd' ? 60000 : name === 'notes' ? 5000 : name === 'url' ? 2000 : 200,
      ['company', 'title', 'jd'].includes(name)
    );
  if (original.url) {
    let url;
    try {
      url = new URL(original.url);
    } catch {
      fail(400, '旧岗位链接无效');
    }
    if (url.protocol !== 'https:' || url.username || url.password) fail(400, '旧岗位链接无效');
    original.url = url.href;
  }
  if (!Array.isArray(bundle.documents) || bundle.documents.length > 20) fail(400, '历史文件清单无效');
  const names = new Set();
  let total = 0;
  const documents = bundle.documents.map(item => {
    const name = textField(item.name, 160, true),
      version = textField(item.version, 100, true);
    const baseline = textField(item.baseline ?? '未知旧基准', 200, true),
      format = name.split('.').pop().toLowerCase();
    if (/[\\/]/.test(name) || !['docx', 'pdf'].includes(format) || names.has(name))
      fail(400, '历史文件名称重复或格式不支持');
    names.add(name);
    if (
      typeof item.base64 !== 'string' ||
      item.base64.length > Math.ceil(FILE_BYTES / 3) * 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.base64)
    )
      fail(400, '历史文件编码无效');
    const bytes = Buffer.from(item.base64, 'base64');
    total += bytes.length;
    if (!bytes.length || bytes.length > FILE_BYTES || total > 20 * 1024 * 1024) fail(413, '历史文件超过容量限制');
    if (hash(bytes) !== item.sha256) fail(409, '历史文件哈希与预览来源不符');
    if (
      format === 'pdf'
        ? bytes.subarray(0, 5).toString() !== '%PDF-'
        : !bytes.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]))
    )
      fail(400, '历史文件内容与扩展名不符');
    return { name, version, baseline, format, sha256: item.sha256, bytes };
  });
  const metadata = documents.map(({ bytes, ...item }) => ({ ...item, size: bytes.length }));
  return {
    sourceKey: r.key,
    original,
    documents,
    metadata,
    total,
    bundleHash: digest({ sourceKey: r.key, original, documents: metadata })
  };
}

function plan(store, owner, data) {
  const account = store.db.prepare('SELECT id,username FROM users WHERE id=?').get(owner);
  if (!account) fail(404, '目标账号不存在');
  if (store.migrationReceipts(owner).some(row => row.sourceKey === data.sourceKey))
    fail(409, '旧 Key 已有迁入记录，请查看来源历史');
  const jobs = store.jobs(owner),
    files = store.files(owner);
  const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
  if (
    jobs.some(
      j =>
        (data.original.url && j.url === data.original.url) ||
        (same(j.company, data.original.company) && same(j.title, data.original.title))
    )
  )
    fail(409, '目标账号存在相同链接或公司标题候选，请先核对，不自动合并');
  const usage = store.usage(owner);
  if (
    usage.jobs.count + 1 > usage.jobs.maxCount ||
    usage.files.count + data.documents.length > usage.files.maxCount ||
    usage.files.bytes + data.total > usage.files.maxBytes
  )
    fail(409, '目标账号容量不足');
  const fingerprint = digest({ owner, bundleHash: data.bundleHash, jobs, files });
  return {
    target: account.username,
    targetId: owner,
    sourceKey: data.sourceKey,
    company: data.original.company,
    title: data.original.title,
    jobCount: 1,
    files: data.metadata,
    fileCount: data.documents.length,
    bytes: data.total,
    classification: 'historical-generated-unreviewed',
    fingerprint,
    bundleHash: data.bundleHash,
    createsReviews: false,
    createsSubmissions: false,
    activatesResume: false
  };
}

export function previewMigration(store, owner, bundle) {
  return plan(store, owner, normalize(bundle));
}

// No HTTP route. The local operator must present the exact preview before confirmation.
export function importMigration(store, owner, bundle, { confirmed, fingerprint } = {}) {
  if (confirmed !== true || !/^[a-f0-9]{64}$/.test(fingerprint ?? '')) fail(400, '需要确认具体迁入预览');
  const data = normalize(bundle);
  store.db.exec('BEGIN IMMEDIATE');
  try {
    const previous = store.migrationReceipts(owner).find(row => row.sourceKey === data.sourceKey);
    if (previous) {
      if (previous.migration?.bundleHash !== data.bundleHash || previous.migration?.previewFingerprint !== fingerprint)
        fail(409, '来源或确认预览已变化，不能覆盖或重复迁入');
      store.db.exec('COMMIT');
      return previous;
    }
    const preview = plan(store, owner, data);
    if (preview.fingerprint !== fingerprint) fail(409, '目标数据或来源已变化，请重新预览');
    const job = store.saveJob(owner, data.original);
    const documents = data.documents.map(item => {
      const file = store.saveFile(owner, item.name, item.bytes);
      return { fileId: file.id, sha256: file.sha256, version: item.version, baseline: item.baseline };
    });
    const receipt = store.recordMigration(owner, {
      source: 'v1-notion',
      sourceKey: data.sourceKey,
      jobId: job.id,
      original: data.original,
      documents,
      migration: { bundleHash: data.bundleHash, previewFingerprint: fingerprint }
    });
    store.db.exec('COMMIT');
    return receipt;
  } catch (error) {
    store.db.exec('ROLLBACK');
    throw error;
  }
}
