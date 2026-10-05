// Self-contained for chrome.scripting.executeScript; no page script or remote code is evaluated.
export function pageFields(mode, targetUrl, fields, expected) {
  function target(value) {
    const u=new URL(value);
    if (u.protocol!=='https:' || u.port || u.username || u.password || !['job-boards.greenhouse.io','boards.greenhouse.io'].includes(u.hostname) || !/^\/[a-z0-9_-]{1,100}\/jobs\/\d{1,20}\/?$/i.test(u.pathname)) throw Error('请打开 Greenhouse 官方岗位页');
    return u.pathname.replace(/\/$/,'');
  }
  if (target(location.href)!==target(targetUrl)) throw Error('当前页面与准备的职位不一致');
  const visible=e=>Boolean(e.getClientRects().length) && getComputedStyle(e).visibility!=='hidden';
  if ([...document.querySelectorAll('input[type=password]')].some(visible)) throw Error('遇到登录，请本人处理');
  if ([...document.querySelectorAll('iframe')].some(e=>visible(e) && /captcha|challenge/i.test(e.title) && e.getBoundingClientRect().height>150)) throw Error('遇到验证，请本人处理');
  const normalize=s=>s.replace(/\*/g,'').trim().toLowerCase();
  const allowed=new Set(['first name','last name','full name','email','linkedin profile','website']);
  const inputs=[...document.querySelectorAll('input')].filter(visible), targets=[];
  for (const f of fields) {
    if (!allowed.has(normalize(f.label))) throw Error('字段不在允许范围内');
    const found=inputs.filter(e=>[...e.labels||[]].some(l=>normalize(l.textContent)===normalize(f.label)));
    if (found.length!==1) throw Error('字段缺失或重复：'+f.label);
    const e=found[0];
    if (!['text','email','url'].includes(e.type) || e.getAttribute('role') && e.getAttribute('role')!=='textbox' || e.disabled || e.readOnly || e.value!=='' || targets.includes(e)) throw Error('字段已有内容或不是可填写普通文本：'+f.label);
    targets.push(e);
  }
  const bindings=targets.map((e,i)=>({index:fields[i].index,label:fields[i].label,id:e.id,type:e.type}));
  if (mode==='preview') return {bindings};
  if (mode!=='fill' || JSON.stringify(bindings)!==JSON.stringify(expected)) throw Error('页面结构已变化，请重新预览');
  let filled=0;
  for (let i=0;i<targets.length;i++) {
    const e=targets[i];
    if (!e.isConnected || !visible(e) || e.disabled || e.readOnly || e.value!=='') throw Error('填写中页面变化，已暂停；已填写 '+filled+' 项，请本人检查');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,fields[i].answer);
    e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true}));
    filled++;
    if (e.value!==fields[i].answer) throw Error('网页未保留答案，已暂停；已操作 '+filled+' 项，请本人检查');
  }
  return {filled};
}
