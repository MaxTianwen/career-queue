import test from 'node:test';import assert from 'node:assert/strict';
import {matchesOpportunity,countryCounts,termPairs,placementGroups,workLocations} from '../web/v2/opportunity.js';
test('workplace substring is trimmed and case insensitive, never JD headquarters or unknown',()=>{
 const j={title:'Software Intern Summer 2027',location:'Toronto, ON, Canada',duration:'4 months'};
 assert(matchesOpportunity(j,{location:'  tOrOnTo  ',year:'2027',season:'summer',months:'4',country:'CA'}));
 for(const location of ['Markham, Canada','Ontario, Canada','Remote','unknown','Headquarters: Toronto'])assert(!matchesOpportunity({...j,location,jd:'Toronto office',company:'Toronto Inc'},{location:'Toronto',unknown:true}));
 assert(matchesOpportunity({...j,location:'Remote'},{location:'REMOTE'}));assert(!matchesOpportunity({...j,location:'Canada',workMode:'remote'},{location:'remote'}));
 assert(matchesOpportunity({...j,location:''},{location:'   '}));
 assert(matchesOpportunity({...j,location:'Ottawa',locations:['Toronto, Canada']},{location:'toronto'}));
 assert(matchesOpportunity({...j,location:['Ottawa','Montreal']},{location:'montreal'}));
 assert.deepEqual(workLocations({location:'unknown',locations:[{company:'Toronto'},'Remote']}),['Remote']);
 assert(!matchesOpportunity(j,{location:'Toronto',year:'2026'}));
 assert(!matchesOpportunity(j,{location:'Toronto',publication:'24h'}));
});
test('country counts describe mutually exclusive parts of same filtered unique set',()=>{
 const rows=[{id:'a',location:'Toronto, Canada'}, {id:'b',location:'Canada / United States',jd:'This role is fully remote.',title:'Software Intern'}, {id:'c',company:'CACI',location:'Remote',jd:'This role is fully remote.'},{id:'d',location:'Unknown'}];
 assert.deepEqual(countryCounts([...rows,rows[0]]),{all:4,CA:2,US:2,caOnly:1,usOnly:1,both:1,other:1});
 assert.deepEqual(countryCounts(rows,{location:'Toronto',country:'US'}),{all:1,CA:1,US:0,caOnly:1,usOnly:0,both:0,other:0});
});
test('same-start placement presentation keeps every duration and end date without crossing years',()=>{
 const p=(season,start,min,max=min,end=null)=>({season,start,end,months:{kind:min===max?'exact':'range',min,max}});
 const placements=[p('summer','2027-05',4,4,'2027-08'),p('summer','2027-05',8,8,'2027-12'),p('summer','2028-05',4),p('summer','2027-06',4)];
 const groups=placementGroups([...placements,placements[0]]);assert.equal(groups.length,3);assert.deepEqual(groups[0].options,['4 个月（至 2027-08）','8 个月（至 2027-12）']);
 const job={jd:'12-16 month internship (starts May 2027). 3-4 month internship (starts January 2027, May 2027, September 2027).'};
 const terms=termPairs(job);assert.equal(terms.filter(x=>x.season==='summer'&&x.year==='2027').length,1);
 assert(matchesOpportunity(job,{season:'summer',year:'2027',months:'4'}));assert(matchesOpportunity(job,{season:'summer',year:'2027',months:'12'}));assert(!matchesOpportunity(job,{season:'winter',year:'2027',months:'12'}));
});
