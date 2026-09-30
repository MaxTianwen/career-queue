import { parseArgs } from 'node:util';
import { loadEnvFile } from 'node:process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NotionStore } from './notion.mjs';
import { normalizeJob, newRecord, comparePreference } from './core.mjs';
import { ingest, getRecord, prepare, complete, submit } from './pipeline.mjs';
import { fetchGreenhouse } from './greenhouse.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
try { loadEnvFile(resolve(root, '.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const print = value => console.log(JSON.stringify(value, null, 2));
const readJson = async path => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));

async function main() {
  const { values: args, positionals } = parseArgs({ allowPositionals: true, options: {
    input: { type: 'string' }, key: { type: 'string' }, parent: { type: 'string' }, date: { type: 'string' },
    knowledge: { type: 'string' }, output: { type: 'string' }, resume: { type: 'string' }, docx: { type: 'string' },
    review: { type: 'string' }, 'cover-letter': { type: 'string' }, checked: { type: 'boolean' },
    confirmed: { type: 'boolean' }, applications: { type: 'boolean' }, 'resume-track': { type: 'string' },
    url: { type: 'string' }, company: { type: 'string' }
  } });
  const command = positionals[0] ?? 'help';
  if (positionals.length > 1) throw new Error('多余参数；路径有空格时请加引号');
  if (command === 'help') {
    console.log(`Career Queue v1.3.0 — Node.js 22+\n\n后台搜索：npm run discover（需要本机 Dashboard）\n运行状态：npm run automation:status\n\n不连接服务即可运行：\n  npm test\n  node src/cli.mjs check\n  node src/cli.mjs preview --input jobs.json\n  node src/cli.mjs fetch-job --url <Greenhouse职位URL> --company <公司名> --output job.json\n\nNotion 接入后：\n  node src/cli.mjs setup\n  node src/cli.mjs verify\n  node src/cli.mjs ingest --input jobs.json\n  node src/cli.mjs list [--applications]\n  node src/cli.mjs get --key <key>\n  node src/cli.mjs prepare --key <key>\n  node src/cli.mjs complete --key <key> --resume resume.pdf --checked\n  node src/cli.mjs submitted --key <key> --date YYYY-MM-DD --confirmed\n\nprepare 只输出单个岗位的生成上下文；由当前助手按知识库生成并审阅材料，不需要 OpenClaw。\ncomplete 必需简历 PDF，--docx / --review 为可选辅助文件，--cover-letter 按岗位要求提供。complete 只标记待提交；submitted 仅记录用户已经实际完成的投递，不提交申请。`);
    return;
  }
  const knowledgePath = args.knowledge ? resolve(args.knowledge) : resolve(root, process.env.CAREER_KNOWLEDGE_PATH ?? 'career_knowledge_base.md');
  const outputRoot = resolve(args.output ?? resolve(root, 'output'));
  if (command === 'fetch-job') {
    if (!args.url || !args.output) throw new Error('需要 --url、--company 和 --output 文件路径');
    const job = await fetchGreenhouse(args.url, args.company);
    const destination = resolve(args.output);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, JSON.stringify([job], null, 2), { flag: 'wx' });
    print({ title: job.title, postedAt: job.postedAt, output: destination, note: '已取得 JD；根据正文补齐未知字段后 preview / ingest。尚未写入 Notion。' });
    return;
  }
  if (command === 'check') {
    let knowledgeReady = false;
    try { knowledgeReady = Boolean((await readFile(knowledgePath, 'utf8')).trim()); } catch {}
    print({ node: process.version, notionTokenConfigured: Boolean(process.env.NOTION_TOKEN),
      notionDataSourceConfigured: Boolean(process.env.NOTION_DATA_SOURCE_ID), notionDatabaseConfigured: Boolean(process.env.NOTION_DATABASE_ID), knowledgeReady,
      note: '只检查配置是否存在，不验证远程连接；用 verify 验证 Notion。当前为手动运行版，OpenClaw 未启用。' });
    return;
  }
  if (command === 'preview') {
    if (!args.input) throw new Error('缺少 --input');
    const inputs = await readJson(args.input);
    if (!Array.isArray(inputs)) throw new Error('职位输入必须为 JSON 数组');
    const records = inputs.map(input => newRecord(normalizeJob(input))).sort(comparePreference);
    print(records.map(({ key, company, title, decision, reasons }) => ({ key, company, title, decision, reasons })));
    return;
  }
  if (!['init', 'setup', 'verify', 'ingest', 'list', 'get', 'prepare', 'complete', 'submitted'].includes(command)) throw new Error('未知命令；运行 npm run cli 查看用法');
  const store = new NotionStore({ token: process.env.NOTION_TOKEN, dataSourceId: process.env.NOTION_DATA_SOURCE_ID });
  if (command === 'init') {
    if (process.env.NOTION_DATA_SOURCE_ID || process.env.NOTION_DATABASE_ID) throw new Error('已有 Notion 目标配置；请用 setup / verify，不重复创建数据库');
    const database = await store.createDatabase(args.parent);
    print({ databaseId: database.id, url: database.url, dataSources: database.data_sources,
      next: '将返回的 data source ID 存入 .env。按 README 建立 Queue / Applications 两个过滤视图。' });
    return;
  }
  if (!store.dataSourceId && process.env.NOTION_DATABASE_ID) await store.resolveDatabase(process.env.NOTION_DATABASE_ID);
  if (command === 'setup') { print(await store.setup()); return; }
  await store.check();
  if (command === 'verify') { print({ notion: 'connected', schema: 'valid' }); return; }
  if (command === 'ingest') {
    if (!args.input) throw new Error('缺少 --input');
    const report = await ingest(store, await readJson(args.input));
    await mkdir(outputRoot, { recursive: true });
    const reportPath = resolve(outputRoot, `discovery-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    await writeFile(reportPath, JSON.stringify(report, null, 2), { flag: 'wx' });
    print({ inserted: report.inserted.length, duplicates: report.duplicates.length, rejected: report.rejected.length, errors: report.errors, report: reportPath });
    if (report.errors.length) process.exitCode = 1;
    return;
  }
  if (command === 'list') {
    const rows = await store.list({ property: 'Status', select: args.applications ? { does_not_equal: 'Queue' } : { equals: 'Queue' } });
    print(rows.filter(row => row.status !== '已归档').sort(comparePreference).map(({ key, company, title, location, salary, url, term, notes, reasons, status, applicationDate, nextStep }) =>
      ({ key, company, title, location, salary, url, term, notes, reasons, status, applicationDate, nextStep })));
    return;
  }
  if (command === 'get') print(await getRecord(store, args.key));
  if (command === 'prepare') print(await prepare(store, args.key, knowledgePath, outputRoot, { resumeTrack: args['resume-track'] ?? 'auto' }));
  if (command === 'complete') print(await complete(store, args.key, { resume: args.resume, docx: args.docx, reviewNotes: args.review, coverLetter: args['cover-letter'] }, args.checked));
  if (command === 'submitted') print(await submit(store, args.key, args.date, args.confirmed));
}

main().catch(error => { console.error(`错误：${error.message}`); process.exitCode = 1; });
