import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export const richText = text => {
  const value = String(text ?? '');
  if (value.length > 45000) throw new Error('Notion 文本超过本版 45000 字符上限，请缩短后重试');
  return value.match(/[\s\S]{1,1900}/g)?.map(content => ({ type: 'text', text: { content } })) ?? [];
};
const plain = property => (property?.rich_text ?? property?.title ?? []).map(x => x.plain_text ?? x.text?.content ?? '').join('');
const textProp = text => ({ rich_text: richText(text) });
const uuid = value => {
  if (!/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(value ?? '')) throw new Error('Notion ID 格式无效，请使用页面 / data source ID');
  return value;
};

export const schema = {
  Position: { title: {} }, Company: { rich_text: {} }, Location: { rich_text: {} }, Salary: { rich_text: {} },
  URL: { url: {} }, Notes: { rich_text: {} },
  Status: { select: { options: [{ name: 'Queue' }, { name: '待提交' }, { name: '已投递' }] } },
  'Application date': { date: {} }, 'Next step': { rich_text: {} }, Term: { rich_text: {} },
  'System notes': { rich_text: {} }, Materials: { files: {} },
  Key: { rich_text: {} }, Payload: { rich_text: {} }, 'Last seen': { date: {} }
};

export class NotionStore {
  constructor({ token, dataSourceId, fetchImpl = fetch, wait = delay }) {
    if (!token) throw new Error('缺少 NOTION_TOKEN；请在本机 .env 配置，不要发到聊天');
    this.token = token;
    this.dataSourceId = dataSourceId ? uuid(dataSourceId) : null;
    this.fetch = fetchImpl;
    this.wait = wait;
  }

  async request(method, path, body) {
    if (!/^\/(pages|databases|data_sources|file_uploads)(\/|$)/.test(path)) throw new Error('不允许的 Notion 接口');
    for (let attempt = 0; attempt < 3; attempt++) {
      const form = body instanceof FormData;
      const response = await this.fetch(`https://api.notion.com/v1${path}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(30000),
        headers: { Authorization: `Bearer ${this.token}`, 'Notion-Version': '2026-03-11', ...(form ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: form ? body : JSON.stringify(body) })
      });
      if (response.status === 429 && attempt < 2) {
        await this.wait(Math.min(Math.max(Number(response.headers.get('retry-after')) || 1, 1), 30) * 1000);
        continue;
      }
      if (!response.ok) throw new Error(`Notion HTTP ${response.status}；请检查权限 / schema。写入结果不明时先读取再重试。`);
      return response.json();
    }
  }

  async createDatabase(parentPageId) {
    return this.request('POST', '/databases', { parent: { type: 'page_id', page_id: uuid(parentPageId) },
      title: richText('Career Queue'), initial_data_source: { properties: schema } });
  }

  async check() {
    if (!this.dataSourceId) throw new Error('缺少 NOTION_DATA_SOURCE_ID');
    const source = await this.request('GET', `/data_sources/${this.dataSourceId}`);
    const missing = Object.entries(schema).filter(([key, value]) => source.properties?.[key]?.type !== Object.keys(value)[0]).map(([key]) => key);
    if (missing.length) throw new Error(`Notion 字段缺失或类型不符：${missing.join(', ')}`);
    return source;
  }

  async resolveDatabase(databaseId) {
    const database = await this.request('GET', `/databases/${uuid(databaseId)}`);
    if (database.data_sources?.length !== 1) throw new Error('数据库包含多个或没有 data source，请明确配置 NOTION_DATA_SOURCE_ID');
    this.dataSourceId = uuid(database.data_sources[0].id);
    return this.dataSourceId;
  }

  async setup() {
    if (!this.dataSourceId) throw new Error('缺少 Notion data source');
    const source = await this.request('GET', `/data_sources/${this.dataSourceId}`);
    const missing = {};
    for (const [name, definition] of Object.entries(schema)) {
      const existing = source.properties?.[name];
      if (existing && existing.type !== Object.keys(definition)[0]) throw new Error(`字段 ${name} 类型冲突，停止配置`);
      if (!existing) missing[name] = definition;
    }
    if (missing.Position && Object.values(source.properties ?? {}).some(p => p.type === 'title')) throw new Error('请先将现有标题字段重命名为 Position');
    if (Object.keys(missing).length) await this.request('PATCH', `/data_sources/${this.dataSourceId}`, { properties: missing });
    return { added: Object.keys(missing), dataSourceId: this.dataSourceId };
  }

  decode(page) {
    const p = page.properties;
    const payload = plain(p.Payload);
    if (!payload) throw new Error(`记录 ${page.id} 缺少 Payload；不覆盖手工记录`);
    return { ...JSON.parse(payload), pageId: page.id, notionUrl: page.url,
      status: p.Status?.select?.name, notes: plain(p.Notes), nextStep: plain(p['Next step']),
      applicationDate: p['Application date']?.date?.start ?? null, lastSeen: p['Last seen']?.date?.start,
      attachments: (p.Materials?.files ?? []).map(file => ({ name: file.name, url: file.file?.url ?? file.external?.url })) };
  }

  async list(filter) {
    if (!this.dataSourceId) throw new Error('缺少 NOTION_DATA_SOURCE_ID');
    const pages = [];
    let cursor;
    do {
      const result = await this.request('POST', `/data_sources/${this.dataSourceId}/query`, { page_size: 100, ...(filter ? { filter } : {}), ...(cursor ? { start_cursor: cursor } : {}) });
      pages.push(...result.results);
      cursor = result.has_more ? result.next_cursor : null;
      if (result.has_more && !cursor) throw new Error('Notion 分页缺少 cursor，停止以避免遗漏');
    } while (cursor);
    return pages.map(page => this.decode(page));
  }

  async find(key) {
    const rows = await this.list({ property: 'Key', rich_text: { equals: key } });
    if (rows.length > 1) throw new Error(`发现重复 Key ${key}；请人工合并，不自动删除`);
    return rows[0] ?? null;
  }

  async findJob(job) {
    const rows = await this.list({ or: [
      { property: 'Key', rich_text: { equals: job.key } },
      { and: [{ property: 'URL', url: { equals: job.url } }, { property: 'Term', rich_text: { equals: job.term } }] }
    ] });
    if (rows.length > 1) throw new Error('同一职位匹配到多条记录，请人工核对；不自动删除');
    return rows[0] ?? null;
  }

  async create(record) {
    const properties = {
      Position: { title: richText(record.title) }, Company: textProp(record.company), Location: textProp(record.location), Salary: textProp(record.salary),
      URL: { url: record.url }, Notes: textProp(''), Status: { select: { name: 'Queue' } },
      'Application date': { date: null }, 'Next step': textProp(record.nextStep), Term: textProp(record.term),
      'System notes': textProp(record.reasons.join('\n')), Key: textProp(record.key), Payload: textProp(JSON.stringify(record)),
      'Last seen': { date: { start: record.lastSeen } }
    };
    const page = await this.request('POST', '/pages', { parent: { type: 'data_source_id', data_source_id: this.dataSourceId }, properties,
      children: [{ object: 'block', type: 'heading_2', heading_2: { rich_text: richText('Job description (source content)') } },
        ...richText(record.jd).map(item => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: [item] } }))] });
    return this.decode(page);
  }

  async touch(record, now) {
    // Discovery only changes last seen, never status, notes, materials or application date.
    await this.request('PATCH', `/pages/${uuid(record.pageId)}`, { properties: { 'Last seen': { date: { start: now.toISOString() } } } });
  }

  async updateState(record, files) {
    const properties = { Status: { select: { name: record.status } }, 'Application date': { date: record.applicationDate ? { start: record.applicationDate } : null },
      'Next step': textProp(record.nextStep), Payload: textProp(JSON.stringify(record)) };
    if (files) properties.Materials = { files };
    await this.request('PATCH', `/pages/${uuid(record.pageId)}`, { properties });
    return record;
  }

  async recordFailure(record, message) {
    await this.request('PATCH', `/pages/${uuid(record.pageId)}`, { properties: { 'System notes': textProp(message) } });
  }

  async updateNotes(record, notes, nextStep) {
    await this.request('PATCH', `/pages/${uuid(record.pageId)}`, { properties: {
      Notes: textProp(notes), 'Next step': textProp(nextStep)
    } });
    return { ...record, notes, nextStep };
  }

  async upload(path, contentType) {
    const data = await readFile(path);
    if (!data.length || data.length > 20 * 1024 * 1024) throw new Error('材料必须为非空且不超过 20MB 的文件');
    const upload = await this.request('POST', '/file_uploads', { mode: 'single_part', filename: basename(path), content_type: contentType });
    const form = new FormData();
    form.append('file', new Blob([data], { type: contentType }), basename(path));
    const sent = await this.request('POST', `/file_uploads/${uuid(upload.id)}/send`, form);
    if (sent.status !== 'uploaded') throw new Error('Notion 材料上传尚未完成；记录状态保持不变');
    return { name: basename(path), type: 'file_upload', file_upload: { id: upload.id } };
  }
}
