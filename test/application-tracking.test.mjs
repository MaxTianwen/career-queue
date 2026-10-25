import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { WorkspaceStore } from '../src/v2/store.mjs';
import { startWorkspace } from '../src/v2/server.mjs';
import { catalogueJob } from '../src/v2/catalogue.mjs';
import { workbook } from '../src/v2/xlsx.mjs';

const password = 'Synthetic tracking password!';
const DAY = 86400000;
const source = { id: 'synthetic', name: 'Synthetic', url: 'https://example.invalid' };
const posting = (id, extra = {}) =>
  catalogueJob(
    {
      company: 'Synthetic Robotics',
      title: 'Software Engineering Intern',
      location: 'Toronto, Canada',
      url: 'https://example.invalid/jobs/' + id,
      jd: 'This is a 4 month internship starting Summer 2027. You will build services.',
      term: 'Summer 2027',
      salary: '$32 per hour',
      workMode: 'hybrid',
      ...extra
    },
    source
  );
// Reads every entry of a stored/deflated zip by walking local headers.
function unzip(bytes) {
  const out = {};
  for (let at = 0; bytes.readUInt32LE(at) === 0x04034b50; ) {
    const method = bytes.readUInt16LE(at + 8),
      size = bytes.readUInt32LE(at + 18),
      nameLength = bytes.readUInt16LE(at + 26),
      extra = bytes.readUInt16LE(at + 28);
    const name = bytes.subarray(at + 30, at + 30 + nameLength).toString('utf8'),
      start = at + 30 + nameLength + extra,
      data = bytes.subarray(start, start + size);
    out[name] = (method === 8 ? inflateRawSync(data) : data).toString('utf8');
    at = start + size;
  }
  return out;
}
async function fixture(clock = { now: Date.parse('2026-10-20T15:00:00Z') }) {
  const database = join(mkdtempSync(join(tmpdir(), 'cq-tracking-')), 'db.sqlite'),
    s = new WorkspaceStore(database, { now: () => clock.now });
  const owner = (await s.createAdmin({ username: 'trackqa', password })).id,
    other = (await s.createAdmin({ username: 'otherqa', password })).id;
  s.saveCatalogue({ jobs: [posting('a'), posting('b', { title: 'Data Analyst Intern', salary: '' })], sources: [] });
  const [a, b] = s.catalogue().jobs.map(job => s.saveSuggested(owner, job.id));
  const submit = (job, date) =>
    s.confirmSubmission(owner, job.id, {
      source: 'manual-confirmation',
      confirmed: true,
      channel: 'employer',
      date,
      receipt: '',
      requestId: randomUUID()
    });
  return { s, owner, other, a, b, submit, clock, database };
}
const row = (s, owner, id) => s.applications(owner).find(item => item.jobId === id);

test('submission snapshots posting facts that survive the posting leaving the catalogue', async () => {
  const { s, owner, a, submit } = await fixture();
  submit(a, '2026-10-12');
  const before = row(s, owner, a.id).tracking;
  assert.equal(before.stage, 'submitted');
  assert.equal(before.appliedDate, '2026-10-12');
  assert.equal(before.factsSource, 'snapshot');
  assert.equal(before.facts.salary, '$32 per hour');
  assert.equal(before.facts.term, 'Summer 2027');
  assert.equal(before.facts.duration, '4 个月');
  assert.equal(before.facts.url, 'https://example.invalid/jobs/a');
  s.saveCatalogue({ jobs: [], sources: [] });
  const after = row(s, owner, a.id).tracking;
  assert.deepEqual(after.facts, before.facts);
});

test('stages form a timeline; voiding keeps the entry and restores the earlier stage', async () => {
  const { s, owner, a, b, submit } = await fixture();
  submit(a, '2026-10-12');
  assert.throws(
    () => s.addApplicationStage(owner, b.id, { stage: 'oa', date: '2026-10-14', requestId: randomUUID() }),
    { status: 409 }
  );
  const oa = randomUUID();
  s.addApplicationStage(owner, a.id, { stage: 'oa', date: '2026-10-14', note: 'HackerRank', requestId: oa });
  // Same request again is a no-op; the same id with other content is refused.
  s.addApplicationStage(owner, a.id, { stage: 'oa', date: '2026-10-14', note: 'HackerRank', requestId: oa });
  assert.throws(
    () => s.addApplicationStage(owner, a.id, { stage: 'oa', date: '2026-10-15', note: '', requestId: oa }),
    { status: 409 }
  );
  assert.throws(
    () => s.addApplicationStage(owner, a.id, { stage: 'interview', date: '2026-10-25', requestId: randomUUID() }),
    { status: 400 }
  );
  assert.throws(
    () => s.addApplicationStage(owner, a.id, { stage: 'submitted', date: '2026-10-15', requestId: randomUUID() }),
    { status: 400 }
  );
  const result = s.addApplicationStage(owner, a.id, {
    stage: 'interview',
    date: '2026-10-18',
    note: '第 1 轮',
    requestId: randomUUID()
  });
  assert.equal(result.tracking.stage, 'interview');
  assert.equal(result.tracking.stageDate, '2026-10-18');
  assert.deepEqual(
    result.tracking.events.map(e => e.label),
    ['测评/OA', '面试']
  );
  const voided = s.voidApplicationStage(owner, a.id, result.tracking.events[1].id, { reason: '记错岗位' });
  assert.equal(voided.tracking.stage, 'oa');
  assert.equal(voided.tracking.events.length, 2);
  assert.equal(voided.tracking.events[1].voidReason, '记错岗位');
  s.addApplicationStage(owner, a.id, { stage: 'rejected', date: '2026-10-19', requestId: randomUUID() });
  assert.equal(row(s, owner, a.id).tracking.ended, true);
});

test('details keep a revision history and refuse stale or empty edits', async () => {
  const { s, owner, a, submit } = await fixture();
  submit(a, '2026-10-12');
  const first = s.saveApplicationTracking(owner, a.id, {
    revision: 0,
    nextStep: '完成 OA',
    due: '2026-11-02T23:59',
    contact: '内推：Synthetic Person',
    notes: 'Synthetic note',
    requestId: randomUUID()
  });
  assert.equal(first.tracking.revision, 1);
  assert.equal(first.tracking.due, '2026-11-02T23:59');
  assert.throws(
    () => s.saveApplicationTracking(owner, a.id, { revision: 0, nextStep: 'x', requestId: randomUUID() }),
    { status: 409 }
  );
  assert.throws(
    () =>
      s.saveApplicationTracking(owner, a.id, {
        revision: 1,
        nextStep: '完成 OA',
        due: '2026-11-02T23:59',
        contact: '内推：Synthetic Person',
        notes: 'Synthetic note',
        requestId: randomUUID()
      }),
    { status: 400 }
  );
  assert.throws(
    () => s.saveApplicationTracking(owner, a.id, { revision: 1, due: 'next week', requestId: randomUUID() }),
    { status: 400 }
  );
  const changes = s.db.prepare('SELECT before_snapshot,after_snapshot FROM application_tracking_changes').all();
  assert.equal(changes.length, 1);
  assert.equal(JSON.parse(changes[0].after_snapshot).nextStep, '完成 OA');
  assert.equal(s.exportData(owner).applicationTrackingChanges.length, 1);
});

test('follow-up reminder appears after 30 quiet days and never changes the stage', async () => {
  const { s, owner, a, submit, clock } = await fixture();
  submit(a, '2026-10-12');
  assert.equal(row(s, owner, a.id).tracking.followUp, false);
  clock.now += 30 * DAY;
  const later = row(s, owner, a.id).tracking;
  assert.equal(later.followUp, true);
  assert.equal(later.stage, 'submitted');
  assert.equal(later.waited, 38);
  assert(later.systemNotes.some(note => note.includes('38 天仍无进展')));
  s.addApplicationStage(owner, a.id, { stage: 'oa', date: '2026-11-01', requestId: randomUUID() });
  assert.equal(row(s, owner, a.id).tracking.followUp, false);
});

test('HTTP routes are owner-scoped and the Excel export contains the record and its link', async t => {
  const { s, owner, a, submit, database } = await fixture({ now: Date.now() });
  submit(a, '2026-10-12');
  s.addApplicationStage(owner, a.id, { stage: 'oa', date: '2026-10-14', note: 'A & B <test>', requestId: randomUUID() });
  const server = await startWorkspace({ port: 0, database });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(r => server.close(r));
    s.close();
  });
  const origin = 'http://127.0.0.1:' + server.address().port;
  const login = async username => {
    const r = await fetch(origin + '/api/login', {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      }),
      data = await r.json();
    return { Origin: origin, Cookie: r.headers.get('set-cookie').split(';')[0], 'X-CQ-CSRF': data.csrf };
  };
  const alice = await login('trackqa'),
    bob = await login('otherqa');
  const put = (headers, body) =>
    fetch(origin + `/api/jobs/${a.id}/tracking`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  assert.equal((await put(bob, { revision: 0, nextStep: 'x', requestId: randomUUID() })).status, 404);
  const saved = await put(alice, { revision: 0, nextStep: '等待面试', requestId: randomUUID() });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).tracking.nextStep, '等待面试');
  const event = await fetch(origin + `/api/jobs/${a.id}/stage-events`, {
    method: 'POST',
    headers: { ...alice, 'Content-Type': 'application/json' },
    body: JSON.stringify({ stage: 'interview', date: '2026-10-15', requestId: randomUUID() })
  });
  assert.equal((await event.json()).tracking.stage, 'interview');
  const download = await fetch(origin + '/api/applications/export.xlsx', { headers: alice });
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition'), /^attachment;.*\.xlsx/);
  const files = unzip(Buffer.from(await download.arrayBuffer()));
  assert(files['xl/worksheets/sheet1.xml'].includes('Synthetic Robotics'));
  assert(files['xl/worksheets/sheet1.xml'].includes('2026-10-12'));
  assert(files['xl/worksheets/sheet1.xml'].includes('等待面试'));
  assert(files['xl/worksheets/_rels/sheet1.xml.rels'].includes('https://example.invalid/jobs/a'));
  assert(files['xl/worksheets/sheet2.xml'].includes('A &amp; B &lt;test&gt;'));
  const empty = unzip(Buffer.from(await (await fetch(origin + '/api/applications/export.xlsx', { headers: bob })).arrayBuffer()));
  assert(!empty['xl/worksheets/sheet1.xml'].includes('Synthetic Robotics'));
});

test('workbook writer escapes text, drops control characters and links only https cells', () => {
  const files = unzip(
    workbook([
      {
        name: 'S',
        columns: [{ header: 'A' }, { header: 'URL', link: true }],
        rows: [
          ['x\u0001<y>&"', 'javascript:alert(1)'],
          ['', 'https://example.invalid/?a=1&b=2']
        ]
      }
    ])
  );
  const sheet = files['xl/worksheets/sheet1.xml'];
  assert(sheet.includes('x&lt;y&gt;&amp;&quot;'));
  assert(!sheet.includes('\u0001'));
  assert.equal((files['xl/worksheets/_rels/sheet1.xml.rels'].match(/<Relationship /g) || []).length, 1);
  assert(files['xl/worksheets/_rels/sheet1.xml.rels'].includes('a=1&amp;b=2'));
  assert(files['[Content_Types].xml'].includes('/xl/worksheets/sheet1.xml'));
});
