import test from 'node:test';
import assert from 'node:assert/strict';
import { descriptionBlocks, jobDescription } from '../web/job-description.js';
import { buildProfile, highlightJob } from '../src/matching.mjs';

const profile = buildProfile(`## 5. 技能与证据范围
| 工作技术 | Python、SQL、PostgreSQL、Node.js | Synthetic evidence; Power BI basic |
| 工作数据分析 | 数据分析、报告 | Synthetic reporting experience |
| C/C++ | C++ | Synthetic project |
| 仅原简历列出、具体案例未展开 | React | Unverified |
`);

test('flat Workday text gets readable sections without rewriting or dropping words', () => {
  const text = 'Our team welcomes students. '.repeat(30) + "Term Length: 8 months Term Start: January 6, 2027 What You'll Do: Build dashboards using SQL. What You'll Need Python and Power BI. Education Enrolled in university.";
  const blocks = descriptionBlocks(text);
  assert.ok(blocks.filter(b => b.type === 'p').length > 3);
  assert.ok(blocks.some(b => b.type === 'h4' && b.text === "What You'll Do:"));
  assert.ok(blocks.some(b => b.type === 'h4' && b.text === "What You'll Need"));
  assert.equal(blocks.map(b => b.text).join(' ').replace(/\s+/g, ' '), text.trim().replace(/\s+/g, ' '));
  for (const b of blocks) assert.equal(text.slice(b.start, b.start + b.text.length), b.text);
});

test('existing bullets and headings retain order; ordinary requirements mentions stay prose', () => {
  const blocks = descriptionBlocks('Qualifications\n• Python\n- SQL\n1. Testing\n\nYour education is important.\nRequirements include teamwork.');
  assert.deepEqual(blocks.map(b => b.type), ['h4', 'li', 'li', 'li', 'p', 'p']);
  assert.equal((jobDescription({ jd: 'Qualifications\n• Python\n• SQL' }).match(/<ul>/g) || []).length, 1);
});

test('full JD highlights include supported aliases, basic skills and experience with no overlap', () => {
  const jd = 'Use PostgreSQL, SQL, nodejs and C++ for dashboards. Qualifications\nPython, Power BI, React, Java.';
  const ranges = highlightJob({ jd }, profile);
  assert.ok(ranges.some(r => jd.slice(r.start, r.end) === 'nodejs' && r.name === 'Node.js'));
  assert.ok(ranges.some(r => r.name === 'Power BI' && r.level === .5));
  assert.ok(ranges.some(r => r.kind === 'experience'));
  assert.ok(ranges.some(r => jd.slice(r.start, r.end) === 'dashboards'));
  assert.ok(ranges.every(r => !['React', 'Java'].includes(r.name)));
  ranges.forEach((r, i) => { if (i) assert.ok(r.start >= ranges[i - 1].end); });
  const html = jobDescription({ jd, jdHighlights: ranges });
  assert.match(html, /class="jd-basic" tabindex="0"/);
  assert.match(html, /Synthetic evidence/);
  assert.match(html, />nodejs<\/mark>/);
  assert.deepEqual(highlightJob({ jd, fullJd: false }, profile), []);
  assert.deepEqual(highlightJob({ jd }, buildProfile('')), []);
});

test('JD and evidence are escaped; untrusted markup never creates executable elements', () => {
  const jd = '<img src=x onerror=alert(1)> Python <script>alert(2)</script>';
  const ranges = highlightJob({ jd }, profile).map(r => ({ ...r, evidence: '"><img src=x onerror=alert(3)>' }));
  const html = jobDescription({ jd, jdHighlights: ranges });
  assert.doesNotMatch(html, /<img|<script|title=""><img/);
  assert.match(html, /&lt;img/);
  assert.match(html, />Python<\/mark>/);
});
