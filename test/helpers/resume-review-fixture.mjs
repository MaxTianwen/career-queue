import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { uploadResumeBase } from '../../src/resume-bases.mjs';
import { DemoStore } from '../../src/demo-store.mjs';
import { dashboardServer } from '../../src/dashboard.mjs';

export async function reviewFixture(runtime) {
  const root = resolve('output/test-runs', randomUUID());
  for (const folder of ['scripts', 'private/resume-templates']) await mkdir(resolve(root, folder), { recursive: true });
  for (const name of ['resume_base.py', 'resume_document.py', 'export-resume.ps1']) await copyFile(resolve('scripts', name), resolve(root, 'scripts', name));
  await writeFile(resolve(root, 'private/resume-templates/templates.json'), JSON.stringify({ python: runtime.python }));
  const original = resolve(root, 'synthetic.docx');
  await promisify(execFile)(runtime.python, ['-c', `import sys
from docx import Document
from docx.shared import Pt
d=Document()
d.styles['Normal'].font.name='Calibri'
d.styles['Normal'].font.size=Pt(11)
d.add_paragraph('Synthetic Candidate - Local Test Only')
d.add_paragraph('SUMMARY')
d.add_paragraph('A synthetic student resume used only to verify local editing, original document preservation and page layout. No real person or application is represented by this document.')
d.add_paragraph('PROJECTS')
d.add_paragraph('Student Project')
d.add_paragraph('Built JavaScript interfaces for a classroom web application.', style='List Bullet')
d.add_paragraph('Built SQL data reports with Python and tested database queries.', style='List Bullet')
d.add_paragraph('EDUCATION')
d.add_paragraph('Synthetic University - Computer Science, sample enrollment only.')
d.save(sys.argv[1])`, original], { windowsHide: true });
  const bytes = await readFile(original);
  const baseline = await uploadResumeBase(root, { track: 'cs', name: 'synthetic.docx', data: bytes.toString('base64') });
  const store = new DemoStore(), first = (await store.list())[0]; store.rows.clear();
  const job = { ...first, company: 'Synthetic Review Lab', title: 'Software Developer Intern', fullJd: true,
    jd: 'Requirements:\nSQL Python data reports and database queries.\nWork on student software projects with the team.\nPaid internship in Toronto, Summer 2027 for 8 months.' };
  await store.create(job);
  const server = dashboardServer({ root, storeOverride: store,
    availabilityImpl: async job => ({ status: 'open', sourceUrl: job.url, checkedAt: new Date().toISOString(), evidence: 'Synthetic open status for isolated local test' }) });
  return { root, original, bytes, baseline, store, job, server };
}
