// Static text only. No eval, Function construction, page-object access or execution.
export function sourceTokens(source){
 if(typeof source!=='string'||source.length>524288)throw Error('SOURCE_SIZE_LIMIT');
 const out=[];let i=0;
 while(i<source.length){const start=i,c=source[i];if(/\s/.test(c)){i++;continue;}
  if(source.slice(i,i+2)==='//'){const e=source.indexOf('\n',i+2);i=e<0?source.length:e+1;continue;}
  if(source.slice(i,i+2)==='/*'){const e=source.indexOf('*/',i+2);if(e<0)throw Error('SOURCE_SYNTAX_UNSUPPORTED');i=e+2;continue;}
  if(c==='"'||c==="'"){const quote=c;let value='',escaped=false;for(i++;i<source.length&&source[i]!==quote;i++){if(source[i]==='\\'){escaped=true;i++;}value+=source[i]||'';}if(i>=source.length)throw Error('SOURCE_SYNTAX_UNSUPPORTED');i++;out.push({kind:'string',value:escaped?null:value,start,end:i});continue;}
  // Do not pretend to parse template interpolation or regex literals.
  if(c==='`'||c==='/')throw Error('SOURCE_SYNTAX_UNSUPPORTED');
  const id=source.slice(i).match(/^[A-Za-z_$][\w$]*/)?.[0];if(id){i+=id.length;out.push({kind:'id',value:id,start,end:i});continue;}
  const n=source.slice(i).match(/^\d+(?:\.\d+)?/)?.[0];if(n){i+=n.length;out.push({kind:'number',value:n,start,end:i});continue;}
  if(!'(){}[];,.?:=+-*!&|<>%'.includes(c))throw Error('SOURCE_SYNTAX_UNSUPPORTED');i++;out.push({kind:'punctuation',value:c,start,end:i});
  if(out.length>100000)throw Error('SOURCE_SIZE_LIMIT');
 }return out;
}
const secret=/token|password|passwd|cookie|session|secret|credential|csrf|auth|email|phone|address|name/i;
const fieldNames=new Set(['action','operation','method','id','jobId','postingId','recordId','view','page','target','url','path','module','submodule','type','posting','postingType']);
function safeLiteral(t,id,field=null){if(!t)return {kind:'missing'};if(t.value===id)return {kind:'selected-id'};if(t.kind!=='string')return {kind:t.kind};if(t.value==='')return {kind:'empty-string'};if(['GET','POST','get','post','_blank','_self','_parent','_top','display','view','show','detail','details'].includes(t.value))return {kind:'route-keyword',value:t.value};if(t.value==='/myAccount/coop/postings.htm')return {kind:'known-list-path',value:t.value};if(field==='action'&&/^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(t.value||'')&&!secret.test(t.value))return {kind:'observed-action-name',value:t.value};if(t.value==='postings.htm'||t.value==='./postings.htm')return {kind:'observed-relative-list-path',value:t.value};return {kind:'redacted-string'};}
export function parseSourceTarget(raw,id){
 if(raw.length>4096)throw Error('HANDLER_SIZE_LIMIT');const t=sourceTokens(raw);let i=t[0]?.value==='return'?1:0;
 const take=v=>{if(t[i++]?.value!==v)throw Error('HANDLER_SHAPE_CHANGED');},ident=()=>{const x=t[i++];if(x?.kind!=='id'||x.value.length>64||secret.test(x.value))throw Error('HANDLER_NAME_REDACTED');return x.value;};
 const object=ident();take('.');const method=ident();take('(');take('{');const fields=[];let count=0;
 while(t[i]?.value!=='}'){if(++count>16)throw Error('HANDLER_SHAPE_CHANGED');const k=t[i++];if(!['string','id'].includes(k?.kind)||!k.value)throw Error('HANDLER_SHAPE_CHANGED');take(':');const v=t[i++];if(!['string','number'].includes(v?.kind))throw Error('HANDLER_SHAPE_CHANGED');fields.push({field:fieldNames.has(k.value)&&!secret.test(k.value)?k.value:'redacted-field-'+count,value:safeLiteral(v,id,k.value)});if(t[i]?.value==='}')break;take(',');}
 take('}');take(',');const first=t[i++];take(',');const second=t[i++];if(first?.kind!=='string'||second?.kind!=='string')throw Error('HANDLER_SHAPE_CHANGED');take(')');take('.');const chainedMethod=ident();take('(');take(')');if(t[i]?.value===';')i++;if(i!==t.length)throw Error('HANDLER_SHAPE_CHANGED');
 if(!fields.some(f=>f.value.kind==='selected-id'))throw Error('HANDLER_ID_MISSING');
 return {object,method,chainedMethod,fields,arguments:[safeLiteral(first,id),safeLiteral(second,id)],runtimeOutcome:'unproven'};
}
export function extractDefinition(source,target){
 if(typeof source!=='string'||source.length>1048576)return {status:'source-size-limit'};
 if(!/^[A-Za-z_$][\w$]{0,63}$/.test(target.object)||!/^[A-Za-z_$][\w$]{0,63}$/.test(target.method))return {status:'invalid-symbol'};
 const esc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const mask=source.split('');let quote=null,comment=null,stringStart=0;
 for(let i=0;i<source.length;i++){const c=source[i],n=source[i+1];if(comment==='line'){mask[i]=' ';if(c==='\n')comment=null;continue;}if(comment==='block'){mask[i]=' ';if(c==='*'&&n==='/'){mask[++i]=' ';comment=null;}continue;}if(quote){mask[i]=' ';if(c==='\\'){if(i+1<source.length)mask[++i]=' ';continue;}if(c===quote){if(source.slice(stringStart+1,i)===target.method&&/^\s*:/.test(source.slice(i+1)))for(let j=stringStart;j<=i;j++)mask[j]=source[j];quote=null;}continue;}if(c==='"'||c==="'"||c==='`'){quote=c;stringStart=i;mask[i]=' ';continue;}if(c==='/'&&n==='*'){comment='block';mask[i]=mask[++i]=' ';continue;}if(c==='/'&&n==='/'){comment='line';mask[i]=mask[++i]=' ';continue;}if(c==='/'){const before=source.slice(0,i).trimEnd();const last=before.slice(-1);if(last===')'||last==='}'){comment='line';mask[i]=' ';continue;}if(before&&!/[=(:,[!&|?;{]/.test(last)&&!/(?:return|case|throw)$/.test(before)){mask[i]=' ';continue;}let end=i+1,inClass=false;for(;end<source.length&&source[end]!=='\n';end++){if(source[end]==='\\'){end++;continue;}if(source[end]==='[')inClass=true;if(source[end]===']')inClass=false;if(source[end]==='/'&&!inClass)break;}if(end<source.length&&source[end]==='/'){for(let j=i;j<=end;j++)mask[j]=' ';i=end;while(/[a-z]/i.test(source[i+1]||'')&&i+1<source.length)mask[++i]=' ';}else mask[i]=' ';}}
 const code=mask.join(''),matches=[];
 const direct=new RegExp('(?<![\\w$.])'+esc(target.object)+'\\s*\\.\\s*'+esc(target.method)+'\\s*=\\s*(function(?:\\s+[A-Za-z_$][\\w$]*)?\\s*\\()','g');
 for(const m of code.matchAll(direct))matches.push({start:m.index+m[0].length-m[1].length,kind:'function-assignment'});
 const objects=new RegExp('(?<![\\w$.])'+esc(target.object)+'\\s*=\\s*\\{','g');
 const key=new RegExp('^(?:'+esc(target.method)+'|"'+esc(target.method)+'"|\''+esc(target.method)+'\')\\s*(?::\\s*(function(?:\\s+[A-Za-z_$][\\w$]*)?\\s*\\()|(\\())');
 for(const m of code.matchAll(objects)){let depth=1,parens=0,brackets=0,propertyStart=true;const begin=m.index+m[0].length;for(let i=begin;i<code.length&&depth;i++){
   if(depth===1&&parens===0&&brackets===0&&propertyStart&&!/\s/.test(code[i])){const k=code.slice(i).match(key);if(k)matches.push({start:k[1]?i+k[0].length-k[1].length:i,kind:k[1]?'object-function-member':'object-method'});propertyStart=false;}
   if(code[i]==='(')parens++;if(code[i]===')')parens--;if(code[i]==='[')brackets++;if(code[i]===']')brackets--;if(code[i]==='{')depth++;if(code[i]==='}')depth--;if(depth===1&&parens===0&&brackets===0&&code[i]===',')propertyStart=true;
  }}

 if(matches.length!==1)return {status:matches.length?'ambiguous-definition':'definition-not-found',candidateCount:matches.length};
 const {start,kind}=matches[0];let end=-1,depth=0,opened=false;quote=null;comment=null;
 for(let i=start;i<Math.min(source.length,start+16384);i++){const c=source[i],next=source[i+1];if(comment==='line'){if(c==='\n')comment=null;continue;}if(comment==='block'){if(c==='*'&&next==='/'){comment=null;i++;}continue;}if(quote){if(c==='\\'){i++;continue;}if(c===quote)quote=null;continue;}if(c==='"'||c==="'"){quote=c;continue;}if(c==='`')return {status:'unsupported-definition-syntax',candidateCount:1};if(c==='/'&&next==='/'){comment='line';i++;continue;}if(c==='/'&&next==='*'){comment='block';i++;continue;}if(c==='/')return {status:'unsupported-definition-syntax'};if(c==='{'){opened=true;depth++;}if(c==='}'&&opened&&!--depth){end=i+1;break;}}
 if(end<0)return {status:'definition-size-or-syntax-limit',candidateCount:1};let tokens;try{tokens=sourceTokens(source.slice(start,end));}catch{return {status:'unsupported-definition-syntax'};}
 const safeStrings=new Set(['form','input','hidden','action','method','target','name','value','GET','POST','get','post','_blank','_self']);
 return {status:'static-definition-found',candidateCount:1,syntax:kind,definition:tokens.map(t=>t.kind==='string'?JSON.stringify(safeStrings.has(t.value)?t.value:'[redacted]'):t.kind==='number'?'0':secret.test(t.value)&&t.kind==='id'?'REDACTED_IDENTIFIER':t.value).join(' '),binding:'text-only-not-runtime-verified',chainedDefinition:'not-resolved-without-return-object-evidence'};
}

// Inject only in ISOLATED world. URLs came from matching script src attributes.
export async function readRestrictedAssets(urls,maxBytes=1048576){
 const origin='https://recruitstudents.torontomu.ca';if(location.origin!==origin||location.pathname!=='/myAccount/coop/postings.htm')return {ok:false,code:'PAGE_CHANGED'};
 if(!Array.isArray(urls)||urls.length!==1||!Number.isInteger(maxBytes)||maxBytes<1||maxBytes>1048576)return {ok:false,code:'SOURCE_ASSET_LIMIT'};
 let u;try{u=new URL(urls[0]);}catch{return {ok:false,code:'UNSAFE_SOURCE_ASSET'};}
 const params=[...u.searchParams];if(u.origin!==origin||u.hash||u.username||u.password||!u.pathname.toLowerCase().endsWith('.js')||params.length>1||params.some(([k,v])=>!['v','ver','version','build'].includes(k)||!/^\d{1,12}(?:\.\d{1,6}){0,4}$/.test(v)||v.length>32))return {ok:false,code:'UNSAFE_SOURCE_ASSET'};
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),2500);let bytesRead=0;
 try{const response=await fetch(u.href,{credentials:'omit',redirect:'error',cache:'no-store',signal:controller.signal,headers:{Accept:'application/javascript,text/javascript'}});
  if(!response.ok)return {ok:true,bytesRead,assets:[{status:'http-error',httpStatus:response.status}]};
  if(!/^(?:application|text)\/(?:x-)?(?:java|ecma)script\b/i.test(response.headers.get('content-type')||''))return {ok:true,bytesRead,assets:[{status:'non-javascript-response'}]};
  const declared=Number(response.headers.get('content-length'));if(Number.isFinite(declared)&&declared>1048576){await response.body?.cancel();return {ok:true,bytesRead,assets:[{status:'skipped-declared-oversize',limitKind:'per-file'}]};}
  const reader=response.body.getReader(),decoder=new TextDecoder();let source='';while(true){const part=await reader.read();if(part.done)break;bytesRead+=part.value.length;if(bytesRead>maxBytes){await reader.cancel();return {ok:true,bytesRead,limitReached:true,limitKind:maxBytes<1048576?'total':'per-file',assets:[{status:'partial-read',source:source+decoder.decode(part.value.slice(0,Math.max(0,maxBytes-(bytesRead-part.value.length))),{stream:true}),limitKind:maxBytes<1048576?'total':'per-file'}]};}source+=decoder.decode(part.value,{stream:true});}source+=decoder.decode();return {ok:true,bytesRead,assets:[{status:'read',source}]};
 }catch{return {ok:true,bytesRead,assets:[{status:controller.signal.aborted?'request-timeout':'request-failed-or-redirect-blocked'}]};}finally{clearTimeout(timer);}
}
