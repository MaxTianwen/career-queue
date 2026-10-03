import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePortalPaste, schoolDeadline } from '../src/portal-paste.mjs';
import { normalizePortalRow, linkPortal, previewPortal } from '../src/portal.mjs';
import { deadlineExpired } from '../src/deadlines.mjs';

const header = ['', 'App Status', 'Term', 'ID', 'Job Title', 'Organization', 'Openings', 'Location', 'App Deadline', ''];
const row = (id = '900001', title = '**NEW** **Web Developer Intern - JR900099**') => ['Shortlist Apply', '', '2027 - Summer', id, title, 'Example Labs', '1', 'Toronto, ON', 'Oct 31, 2026 11:59 PM', ''];
const markdown = data => [header, header.map(() => ':---'), ...data].map(c => `| ${c.join(' | ')} |`).join('\n');

test('portal multiline headers preserve blank status, action cells, last trailing tab and school versus employer IDs', () => {
  const wrapped = 'App Status\tTerm\t\nID\nJob Title\nOrganization\nOpenings\nLocation\nApp Deadline';
  const parsed = parsePortalPaste(wrapped + '\n' + row('900111', 'NEW Developer - 140972').join('\t') + '\n' + row('900112', 'Intern - 2027').slice(0, -1).join('\t'));
  assert.equal(parsed.rows.length, 2); assert.equal(parsed.rows[0].id, '900111'); assert.equal(parsed.rows[0].requisitionId, '140972');
  assert.equal(parsed.rows[0].sourceStatus, ''); assert.equal(parsed.rows[0].company, 'Example Labs');
  assert.equal(parsed.rows[0].term, 'Summer 2027'); assert.equal(parsed.rows[1].requisitionId, '');
  assert.equal(parsed.errors.length, 0);
  const applied = row(); applied[0] = 'Shortlist Applied'; applied[1] = 'Application Submitted';
  assert.equal(parsePortalPaste(wrapped + '\n' + applied.join('\t')).rows[0].sourceStatus, 'Application Submitted');
  const invalid = row(); invalid.splice(1, 1);
  const mixed = parsePortalPaste(wrapped + '\n' + row().join('\t') + '\n' + invalid.join('\t'));
  assert.equal(mixed.rows.length, 1); assert.equal(mixed.errors.length, 1);
  assert.throws(() => parsePortalPaste(wrapped.replace('Organization', 'Surprise') + '\n' + row().join('\t')), /未识别到学校表头/);
});

test('copied Markdown preserves blank status, detects partial copy and duplicate employer IDs without merging school IDs', () => {
  const parsed = parsePortalPaste('**TOTAL RESULTS:** **67**\n\n' + markdown([row(), row('900002')]));
  assert.equal(parsed.parsedCount, 2); assert.equal(parsed.reportedTotal, 67);
  assert.equal(parsed.rows[0].sourceStatus, ''); assert.equal(parsed.rows[0].term, 'Summer 2027');
  assert.equal(parsed.rows[0].title, 'Web Developer Intern - JR900099');
  assert.equal(parsed.rows[0].requisitionId, 'JR900099'); assert.equal(parsed.rows[0].url, '');
  assert.equal(parsed.rows[0].deadline, '2026-10-31T23:59:00-04:00');
  assert.ok(parsed.warnings.some(x => x.includes('67') && x.includes('2')));
  assert.ok(parsed.warnings.some(x => x.includes('900001、900002')));
  assert.equal(parsed.errors.length, 0);
  assert.deepEqual(previewPortal(parsed.rows, [])[0].relatedSchoolIds, ['900002']);
});

test('browser TSV and repeated headers preserve column alignment, title codes and original source statuses', () => {
  const data = [row('900003', 'NEW Test Development (900888)'), row('900004', 'Intern [12 - 16 Months]'), row('900005', 'NEW Design [900777]')];
  data[0][1] = 'Submitted';
  const parsed = parsePortalPaste([header, data[0], header, ...data.slice(1)].map(c => c.join('\t')).join('\n'));
  assert.equal(parsed.rows.length, 3); assert.equal(parsed.rows[0].sourceStatus, 'Submitted');
  assert.deepEqual(parsed.rows.map(r => r.requisitionId), ['900888', '', '900777']);
  assert.equal(parsed.rows[0].company, 'Example Labs');
  assert.equal(normalizePortalRow(parsed.rows[0]).sourceStatus, 'Submitted');
});

test('parser preserves provided links, rejects incomplete rows, and never treats page legend as a job', () => {
  const data = row(); data[4] = '**NEW** [Web Developer - JR900099](https://school.example/jobs/900001)';
  const parsed = parsePortalPaste('Job no longer available\n' + markdown([data, row().slice(1)]));
  assert.equal(parsed.rows.length, 1); assert.equal(parsed.rows[0].url, 'https://school.example/jobs/900001');
  assert.equal(parsed.errors.length, 1);
  assert.throws(() => parsePortalPaste('No table here'));
  assert.throws(() => parsePortalPaste(markdown(Array.from({ length: 101 }, (_, i) => row(String(900000 + i))))));
  const bad = row(); bad[8] = 'soon';
  const invalid = parsePortalPaste(markdown([bad])).rows[0];
  assert.equal(invalid.deadline, ''); assert.equal(invalid.deadlineText, 'soon'); assert.ok(invalid.parseWarning);
});

test('school deadlines preserve Toronto minute precision, daylight saving and date-only semantics', () => {
  const oct = schoolDeadline('Oct 31, 2026 11:59 PM').deadline;
  assert.equal(deadlineExpired(oct, new Date('2026-11-01T03:58:59Z')), false);
  assert.equal(deadlineExpired(oct, new Date('2026-11-01T03:59:01Z')), true);
  assert.equal(schoolDeadline('Dec 1, 2026 12:00 AM').deadline, '2026-12-01T00:00:00-05:00');
  assert.equal(schoolDeadline('Oct 9, 2026').deadline, '2026-10-09');
  for (const text of ['Feb 30, 2026 11:59 PM', 'Oct 9, 2026 13:59 PM', 'Nov 1, 2026 1:30 AM', 'Mar 8, 2026 2:30 AM']) assert.throws(() => schoolDeadline(text));
});

test('plain-text reimports preserve existing links, state and audit history', () => {
  const input = parsePortalPaste(markdown([row()])).rows[0], base = { key: 'a', status: 'Queue' };
  const record = linkPortal(base, { ...input, url: 'https://school.example/job', externalUrl: 'https://example.com/job' }, [], { confirmed: true });
  const again = linkPortal(record, input, [record], { confirmed: true });
  assert.deepEqual(again, record); assert.equal(again.portal.status, 'unknown');
  assert.equal(again.portal.requisitionId, 'JR900099');
});
