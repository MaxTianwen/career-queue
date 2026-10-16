import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WorkspaceStore} from '../src/v2/store.mjs';
import {durationFacts} from '../src/duration-facts.mjs';
import {jobCountries} from '../src/job-country.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/school-official-identity/cases.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
function setup(t){const database=join(mkdtempSync(join(tmpdir(),'cq-identity-')),'db.sqlite'),s=new WorkspaceStore(database);t.after(()=>s.close());for(const id of ['a','b']){s.db.prepare('INSERT INTO users(id,username,salt,password_hash,preferences) VALUES(?,?,?,?,?)').run(id,id,'synthetic','synthetic','{}');s.db.prepare('INSERT INTO school_opportunities VALUES(?,?,?,?)').run(id,fixture.school.id,JSON.stringify(fixture.school),1);}return {s,database,item:s.schoolOpportunities('a')[0]};}
for(const conflict of fixture.conflicts)test('school official cache rejects '+conflict.name,t=>{
 const {s,item}=setup(t);s.cacheSchoolOfficialDetail('a',item.schoolId,item.fingerprint,fixture.official);const before=s.db.prepare('SELECT payload FROM school_official_cache').get().payload;
 const wrong={...fixture.official,...conflict,sourceEvidence:{...fixture.official.sourceEvidence,url:conflict.url},jd:'Summer 2027 internship. Duration: 4 months.'};
 assert.throws(()=>s.cacheSchoolOfficialDetail('a',item.schoolId,item.fingerprint,wrong),/identity/);assert.equal(s.db.prepare('SELECT payload FROM school_official_cache').get().payload,before);
});
test('exact school official enrichment survives reopening without changing school source or another owner',t=>{
 const {s,database,item}=setup(t);const original=s.db.prepare('SELECT snapshot FROM school_opportunities WHERE user_id=?').get('a').snapshot;
 s.cacheSchoolOfficialDetail('a',item.schoolId,item.fingerprint,fixture.official);
 const reopened=new WorkspaceStore(database);try{const row=reopened.pendingOpportunities('a')[0];assert.deepEqual(durationFacts(row).options,[8]);assert.equal(row.term,'Summer 2027');assert.equal(row.location,fixture.school.location);assert.deepEqual(jobCountries(row),['CA']);assert.equal(row.postedAt,'2026-10-01');assert.equal(reopened.pendingOpportunities('b')[0].jd,'');assert.equal(reopened.db.prepare('SELECT snapshot FROM school_opportunities WHERE user_id=?').get('a').snapshot,original);assert.equal(reopened.applications('a').length,0);}finally{reopened.close();}
});
