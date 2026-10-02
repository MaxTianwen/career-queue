// Read-only local preview, separate from the production Dashboard.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const files = new Set(['index.html','demo-data.js','option-a.html','option-a.css','option-a.js','option-b.html','option-b.css','option-b.js','selected.html','selected.css']);
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8' };
const server = createServer(async (req,res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405);res.end();return; }
  const path = new URL(req.url, 'http://127.0.0.1').pathname;
  if(path === '/__design_health'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({service:'career-queue-design-v14'}));return;}
  const name = path === '/' ? 'index.html' : path.slice(1);
  if(!files.has(name)){res.writeHead(404);res.end('Not found');return;}
  try{const bytes=await readFile(join(root,name));res.writeHead(200,{'Content-Type':types[extname(name)],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; frame-src 'self'; base-uri 'none'; form-action 'none'"});res.end(req.method==='HEAD'?undefined:bytes);}
  catch{res.writeHead(404);res.end('Not found');}
});
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'预览端口 4319 已被占用；未停止任何其他程序。':error.message);process.exitCode=1;});
server.listen(4319,'127.0.0.1',()=>console.log('Career Queue design preview: http://127.0.0.1:4319/'));
