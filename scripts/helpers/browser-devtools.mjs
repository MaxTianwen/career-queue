import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

// Only read the fresh profile belonging to the browser spawned by this test.
export async function waitForDevToolsPort(profile, child, {timeoutMs=30000, intervalMs=50}={}) {
  let failure;
  const onError=error=>{failure=error;};
  child.on('error',onError);
  const deadline=Date.now()+timeoutMs;
  try {
    do {
      if(failure)throw new Error('Test browser failed to start: '+failure.message);
      if((child.exitCode!=null&&child.exitCode!==0)||child.signalCode!=null)throw new Error('Test browser exited before DevTools became ready');
      try {
        const [port,path]=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).trim().split(/\r?\n/);
        if(/^\d+$/.test(port)&&Number(port)>0&&Number(port)<=65535&&/^\/devtools\/browser\/[\w-]+$/.test(path||''))return Number(port);
      } catch(error) {if(error.code!=='ENOENT')throw error;}
      await delay(intervalMs);
    } while(Date.now()<deadline);
    throw new Error('Timed out waiting for isolated browser DevToolsActivePort');
  } finally {child.off('error',onError);}
}
