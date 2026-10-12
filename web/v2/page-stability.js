// Privacy masking retains layout and scroll; returning validates the session only.
export function returnGuard({validate,mask,clearPreview,invalid}) {
 let epoch=0;
 return {hide(){epoch++;clearPreview();mask(true);},async show(){const ticket=++epoch;try{const valid=await validate();if(ticket!==epoch)return;if(!valid)return invalid();mask(false);}catch{if(ticket===epoch)invalid();}},stop(){epoch++;}};
}
// Keep expanded details, focus, pagination and the visible card's screen position on data refresh.
export function preserveList(container,render,{window:win=window,document:doc=document}={}){
 const cards=[...container.querySelectorAll('[data-job-id]')],anchor=cards.find(c=>c.getBoundingClientRect().bottom>0),top=anchor?.getBoundingClientRect().top;
 const open=cards.flatMap(c=>[...c.querySelectorAll('details')].map((d,i)=>d.open?[c.dataset.jobId,i]:null).filter(Boolean));
 const active=doc.activeElement,focused=active?.closest?.('[data-job-id]'),index=focused?[...focused.querySelectorAll('a,button,summary')].indexOf(active):-1;
 const x=win.scrollX,y=win.scrollY,horizontal=container.querySelector?.('.table-scroll')?.scrollLeft || 0;render();const next=[...container.querySelectorAll('[data-job-id]')];
 for(const[id,i]of open){const d=next.find(c=>c.dataset.jobId===id)?.querySelectorAll('details')[i];if(d)d.open=true;}
 if(focused&&index>=0)next.find(c=>c.dataset.jobId===focused.dataset.jobId)?.querySelectorAll('a,button,summary')[index]?.focus({preventScroll:true});
 const frame=container.querySelector?.('.table-scroll');if(frame)frame.scrollLeft=horizontal;
 const target=anchor&&next.find(c=>c.dataset.jobId===anchor.dataset.jobId);win.scrollTo(x,target?y+target.getBoundingClientRect().top-top:y);
}

// Account-session memory only: keep rendered views, coalesce reads, invalidate on writes/logout.
export function viewLoader({now=Date.now,maxAge=60000}={}) {
 const entries=new Map();
 return {
  invalidate(key){if(key)entries.delete(key);else entries.clear();},
  run(key,load,{force=false}={}){
   const previous=entries.get(key);
   if(previous?.pending)return previous.pending;
   if(!force&&previous?.done&&now()-previous.at<maxAge)return Promise.resolve();
   const entry={done:false,at:0,pending:null};entries.set(key,entry);
   const current=()=>entries.get(key)===entry;
   entry.pending=Promise.resolve().then(()=>load(current)).then(value=>{if(current()){entry.done=true;entry.at=now();}return value;}).catch(error=>{if(current())entries.delete(key);throw error;}).finally(()=>{entry.pending=null;});
   return entry.pending;
  }
 };
}
