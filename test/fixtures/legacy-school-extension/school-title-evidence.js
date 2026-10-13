// Read-only, self-contained ISOLATED function. Never evaluates page code or follows links.
export function schoolTitleEvidence(expected){
 const stop=code=>({ok:false,code});
 if(location.origin!=='https://recruitstudents.torontomu.ca'||location.pathname!=='/myAccount/coop/postings.htm')return stop('PORTAL_CHANGED');
 if(!Array.isArray(expected)||!expected.length||expected.length>2||expected.some(e=>!/^\d{4,10}$/.test(e.schoolId)||!e.title||!e.company||!e.term)||new Set(expected.map(e=>e.schoolId)).size!==expected.length)return stop('SELECTED_PLAN_REQUIRED');
 const visible=e=>Boolean(e?.getClientRects().length)&&getComputedStyle(e).visibility!=='hidden'&&!e.closest('[hidden],[aria-hidden=true]');
 if([...document.querySelectorAll('input[type=password],iframe[title*=captcha i],iframe[title*=challenge i]')].some(visible))return stop('VISIBLE_AUTH_CHALLENGE');
 const text=e=>{let s='';const w=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);for(let n=w.nextNode();n&&s.length<10000;n=w.nextNode()){const p=n.parentElement;if(p&&visible(p)&&!p.closest('input,textarea,select,script,style,[contenteditable=true]'))s+=' '+n.textContent;}return s.replace(/\s+/g,' ').trim();};
 const cells=row=>[...row.children].filter(e=>/^(TD|TH)$/.test(e.tagName)||['cell','columnheader','gridcell'].includes(e.getAttribute('role')));
 const found=new Map(expected.map(e=>[e.schoolId,[]]));
 for(const table of document.querySelectorAll('table,[role=grid]')){
  const rows=[...table.querySelectorAll('tr,[role=row]')].filter(visible);const header=rows.find(r=>cells(r).some(c=>/^Job Title$/i.test(text(c)))&&cells(r).some(c=>/^ID$/i.test(text(c))));if(!header)continue;
  const labels=cells(header).map(text),at=name=>labels.findIndex(x=>x.toLowerCase()===name.toLowerCase());
  for(const row of rows){const cs=cells(row),id=cs[at('ID')]?text(cs[at('ID')]):'';const e=expected.find(e=>e.schoolId===id);if(!e)continue;
   const cell=cs[at('Job Title')];if(!cell||text(cell).replace(/^NEW\s+/,'')!==e.title||!cs[at('Organization')]||text(cs[at('Organization')])!==e.company||!cs[at('Term')]||text(cs[at('Term')])!==e.term)return stop('SELECTED_IDENTITY_CHANGED');
   const targets=[...cell.querySelectorAll('a,button,[role=link],[tabindex]')].filter(n=>visible(n)&&text(n)===e.title&&!n.closest('form'));
   if(targets.length!==1||targets[0].tagName!=='A'||targets[0].getAttribute('role')!=='button')return stop('AMBIGUOUS_TITLE_TARGET');found.get(id).push(targets[0]);
  }
 }
 if([...found.values()].some(x=>x.length!==1))return stop('SELECTED_TITLE_NOT_UNIQUE_OR_VISIBLE');
 // Drop comments and every literal before recognizing fixed syntax categories. No source or identifiers exported.
 const mask=raw=>raw.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g,' ');
 const rules=[['window-open',/\bwindow\s*\.\s*open\s*\(/],['unqualified-open',/(?:^|[^.\w])open\s*\(/],['location-reference',/\blocation\b/],['history-route',/\bhistory\s*\.\s*(?:pushState|replaceState)\s*\(/],['trusted-reference',/\.\s*isTrusted\b/],['activation-reference',/\buserActivation\b/],['prevent-default',/\.\s*preventDefault\s*\(/],['stop-propagation',/\.\s*stop(?:Immediate)?Propagation\s*\(/],['network-reference',/\b(?:fetch|XMLHttpRequest)\s*\(/]];
 const eventNames=['onclick','onpointerdown','onpointerup','onmousedown','onmouseup','onkeydown','onkeyup'];
 const link=raw=>{if(raw===null)return{kind:'absent'};if(raw.length>2048)return{kind:'over-limit'};if(raw===''||raw.startsWith('#'))return{kind:'empty-or-fragment'};if(/^javascript:/i.test(raw))return{kind:/^javascript:\s*(?:void\s*\(\s*0\s*\)|;)\s*;?\s*$/i.test(raw)?'inert-javascript':'javascript-present'};try{const u=new URL(raw,location.href);return{kind:u.protocol!=='https:'?'non-https':u.origin!==location.origin?'other-origin':u.pathname==='/myAccount/coop/postings.htm'?'same-origin-job-path':'other-same-origin-path',queryRemoved:!!u.search,fragmentRemoved:!!u.hash,credentialsRemoved:!!(u.username||u.password)};}catch{return{kind:'invalid'};}};
 const jobs=expected.map(e=>{const nodes=[];let n=found.get(e.schoolId)[0];for(let depth=0;n&&depth<5&&!['BODY','HTML'].includes(n.tagName);depth++,n=n.parentElement){
  const handlers=eventNames.flatMap(name=>{const raw=n.getAttribute(name);if(raw===null)return[];const truncated=raw.length>4096,code=mask(raw.slice(0,4096));return[{event:name.slice(2),sourceOmitted:true,truncated,syntaxHints:rules.filter(([,re])=>re.test(code)).map(([label])=>label)}];});
  const target=n.getAttribute('target'),role=n.getAttribute('role'),aria=n.getAttribute('aria-disabled'),tabindex=n.getAttribute('tabindex');
  nodes.push({depth,tag:['A','BUTTON','TD','TH','TR','TABLE','TBODY','DIV','SPAN','SECTION','MAIN','UL','LI','FORM'].includes(n.tagName)?n.tagName:'OTHER',role:['button','link','cell','row','grid','gridcell','dialog'].includes(role)?role:null,href:link(n.getAttribute('href')),target:target===null?'absent':['_blank','_self','_parent','_top'].includes(target)?target:'named-value-omitted',ariaDisabled:aria===null?'absent':['true','false'].includes(aria)?aria:'other-value-omitted',disabled:n.hasAttribute('disabled'),inert:n.hasAttribute('inert'),tabIndex:tabindex===null?'absent':tabindex==='-1'?'negative':tabindex==='0'?'zero':/^\d+$/.test(tabindex)?'positive':'other-value-omitted',handlers});
 }return{schoolId:e.schoolId,identityVerified:true,nodes,ancestorLimit:5,ancestorsTruncated:!!n&&!['BODY','HTML'].includes(n.tagName)};});
 const scripts=[...document.querySelectorAll('script[src]')],scriptClues={inspected:0,sameOrigin:0,otherOrigin:0,unclassified:0,knownLibraryNames:[],truncated:scripts.length>40,relationshipToSelectedHandlers:'unknown',bodiesRead:false,requestsMade:false};
 const known=new Set();for(const script of scripts.slice(0,40)){const raw=script.getAttribute('src');scriptClues.inspected++;if(!raw||raw.length>2048){scriptClues.unclassified++;continue;}try{const u=new URL(raw,location.href);if(!['http:','https:'].includes(u.protocol)){scriptClues.unclassified++;continue;}if(u.origin!==location.origin){scriptClues.otherOrigin++;continue;}scriptClues.sameOrigin++;const file=u.pathname.split('/').pop().toLowerCase();for(const name of ['jquery','bootstrap','angular','react','vue','knockout','orbis'])if(new RegExp('^'+name+'(?:[.-]|$)').test(file))known.add(name);}catch{scriptClues.unclassified++;}}
 scriptClues.knownLibraryNames=[...known].sort();
 return{ok:true,schema:'career-queue-school-title-evidence-v1',capturedAt:new Date().toISOString(),jobs,scriptClues,limits:{eventListenerEnumeration:'unavailable-in-standard-extension-api',historicalConsoleErrors:'unavailable',inlineHints:'syntax-only-not-proof-of-execution-or-gating',scriptRelationship:'not-established',rawEventSourceExported:false,rawUrlsExported:false,formValuesRead:false,cookiesOrStorageRead:false,automaticClicks:false,permissionRequested:false}};
}
