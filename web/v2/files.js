export function renderFiles(container,files,{trash=false,parse,download,remove,restore,classify,view}={}){
 container.replaceChildren();
 const node=(tag,text,cls)=>{const e=document.createElement(tag);e.textContent=text;if(cls)e.className=cls;return e;};
 if(!files.length)container.append(node('p',trash?'回收站为空。':'暂未保存文件。','empty'));
 const groups=new Map();for(const [kind,label] of [['resume','Resume · 简历'],['cover','Cover Letter · 求职信'],['unknown','待分类 · 旧文件']]){const section=node('section','','file-group');section.dataset.kind=kind;section.append(node('h3',label));container.append(section);groups.set(kind,section);if(!files.some(f=>(f.kind||'unknown')===kind))section.append(node('p',trash?'没有此类归档文件。':'暂无此类文件。','empty'));}
 for(const file of files){
  const row=node('div','','file-row'),text=node('div',''),name=node('strong',file.name),meta=node('small',`${file.format.toUpperCase()} · ${Math.ceil(file.size/1024)} KB · ${new Date(file.created).toLocaleString()} · 版本 ${file.id.slice(0,8)} · ${file.origin?.label||'文件'}`);
  text.append(name,meta);row.append(text);const actions=node('div','','actions');row.append(actions);
  const button=(label,fn)=>{const b=node('button',label);b.type='button';b.setAttribute('aria-label',`${label} ${file.name}`);b.onclick=async()=>{b.disabled=true;try{await fn(b);}finally{b.disabled=false;}};actions.append(b);return b;};
  if(view)button('预览',b=>view(file,b));
  if(trash){button('还原',()=>restore(file));text.append(node('small',`移入回收站：${new Date(file.deletedAt).toLocaleString()} · 文件内容仍保留`));}
  else{
   if(file.kind==='resume')button('解析并查看',()=>parse(file));button('下载',()=>download(file));
   if((file.kind||'unknown')==='unknown'&&classify){if(file.kindConflict)text.append(node('small','历史中同时用于简历和求职信；保留历史，不自动归类。'));else{button('归为简历',()=>classify(file,'resume'));button('归为求职信',()=>classify(file,'cover'));}}
   const removeButton=button('删除',()=>{confirm.hidden=false;confirm.querySelector('button').focus();});
   const confirm=node('div','','file-delete-confirm');confirm.hidden=true;confirm.setAttribute('role','group');confirm.setAttribute('aria-label','确认删除文件');
   confirm.append(node('p',`将「${file.name}」（${file.format.toUpperCase()}）移入回收站？可以还原，历史引用和原文件内容不变；不再用于新的材料选择。`));
   const cancel=node('button','取消');cancel.type='button';cancel.onclick=()=>{confirm.hidden=true;removeButton.focus();};
   const yes=node('button','确认移入回收站');yes.type='button';yes.onclick=async()=>{yes.disabled=true;cancel.disabled=true;try{await remove(file);}finally{yes.disabled=false;cancel.disabled=false;}};
   confirm.append(cancel,yes);row.append(confirm);
   if(file.deleteBlocked){removeButton.dataset.fileDeleteBlocked='true';removeButton.disabled=true;text.append(node('small',file.deleteBlocked));}
  }
  groups.get(file.kind||'unknown').append(row);
 }
}
