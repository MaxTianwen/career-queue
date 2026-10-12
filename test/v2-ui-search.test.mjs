import test from 'node:test';
import assert from 'node:assert/strict';
import {matchesOpportunity} from '../web/v2/opportunity.js';
const job={company:'Northstar Labs',title:'Software Engineer Intern',requisitionId:'REQ-123',schoolSources:[{schoolId:'900001'}],location:'Toronto, Canada',term:'Summer 2027',duration:'8 months',hasSchool:true};
test('search combines company/title/identifiers without searching private notes or overriding filters',()=>{
 for(const query of ['northstar engineer',' REQ-123 ','900001'])assert.equal(matchesOpportunity(job,{query,country:'CA',months:'8'}),true);
 assert.equal(matchesOpportunity(job,{query:'northstar',months:'4'}),false);
 assert.equal(matchesOpportunity(job,{query:'northstar',country:'US'}),false);
 assert.equal(matchesOpportunity({...job,notes:'secret draft'},{query:'secret'}),false);
 assert.equal(matchesOpportunity(job,{query:'unknown company'}),false);
 assert.equal(matchesOpportunity(job,{query:'  '}),true);
});
