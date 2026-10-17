import test from 'node:test';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {mkdtempSync,writeFileSync,existsSync} from 'node:fs';import {resolve} from 'node:path';import {tmpdir} from 'node:os';
test('legacy and v2 Word exporters refuse a shared occupied mutex before opening documents',{skip:process.platform!=='win32'},()=>{
 const folder=mkdtempSync(resolve(tmpdir(),'cq-word-guard-')),input=resolve(folder,'synthetic.docx'),output=resolve(folder,'result.pdf');writeFileSync(input,'Synthetic: must never reach Word');
 const quote=s=>"'"+s.replaceAll("'","''")+"'";
 for(const [script,args] of [['scripts/export-resume.ps1',`-InputDocx ${quote(input)} -OutputPdf ${quote(output)}`],['scripts/v2-word-export.ps1',`-Folder ${quote(folder)}`]]){
  const command=`$m=New-Object System.Threading.Mutex($false,'Local\\CareerQueueV2Word');$held=$m.WaitOne(0);if(-not $held){throw 'External mutex busy'};try{& powershell.exe -NoProfile -NonInteractive -File ${quote(resolve(script))} ${args} 2>&1 | Out-String;Write-Output ('CHILD_EXIT='+$LASTEXITCODE)}finally{$m.ReleaseMutex();$m.Dispose()}`;
  const text=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',windowsHide:true,timeout:20000});assert.match(text,/WORD_BUSY/);assert.match(text,/CHILD_EXIT=1/);assert.equal(existsSync(output),false);
 }
});
