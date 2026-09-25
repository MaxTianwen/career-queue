import { normalizeJob, newRecord } from './core.mjs';

// Explicit, temporary demo data. No Notion calls and no real personal profile.
export class DemoStore {
  constructor() {
    this.rows = new Map();
    const samples = [
      ['示例公司 · Maple Lab', 'Software Developer Intern', 'Toronto · Hybrid', 8, 'Summer 2027'],
      ['示例公司 · North Data', 'Data Analyst Co-op', 'Markham · Hybrid', 4, 'Fall 2027'],
      ['示例公司 · Cloud Studio', 'Platform Engineering Intern', 'Remote · Canada', 8, 'Summer 2027']
    ];
    for (const [company, title, location, durationMonths, term] of samples) {
      const row = newRecord(normalizeJob({ company, title, location, durationMonths, term,
        url: `https://example.com/demo/${this.rows.size + 1}`, workMode: location.includes('Remote') ? 'remote' : 'hybrid',
        inGta: true, remoteEligible: null, salary: '薪资未披露', paid: null, isIntern: true, relevant: true,
        jd: '演示职位，不代表真实招聘。\n\n参与应用开发或数据分析，与团队协作完成任务。\n要求：在读学生，了解编程基础；具体资格、薪资及发布时间需要核实。' }));
      this.rows.set(row.key, row);
    }
  }
  async list() { return structuredClone([...this.rows.values()]); }
  async find(key) { return structuredClone(this.rows.get(key) ?? null); }
  async findJob(job) { return (await this.list()).find(x => x.key === job.key || (x.url === job.url && x.term === job.term)) ?? null; }
  async create(record) { this.rows.set(record.key, structuredClone(record)); return record; }
  async touch(record, now) { this.rows.get(record.key).lastSeen = now.toISOString(); }
  async updateState(record) { return this.create(record); }
  async updateNotes(record, notes, nextStep) { return this.create({ ...record, notes, nextStep }); }
  async upload() { return { demo: true }; }
  async recordFailure(record, message) { this.rows.get(record.key).error = message; }
}
