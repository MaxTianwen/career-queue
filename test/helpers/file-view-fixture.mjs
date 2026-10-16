import {execFileSync} from 'node:child_process';import {readFileSync,existsSync} from 'node:fs';export const python=process.env.CQ_V2_TEST_PYTHON||(existsSync('private/v2-local/runtime.json')?JSON.parse(readFileSync('private/v2-local/runtime.json')).python:'python');
export function documentBytes(kind='pdf'){return execFileSync(python,['-c',[
'import io,sys',
'from reportlab.pdfgen.canvas import Canvas',
'from docx import Document',
'kind=sys.argv[1]; out=io.BytesIO()',
'if kind in ("docx","short"):',
' d=Document();d.add_paragraph("Hi" if kind=="short" else "<img src=x onerror=alert(1)> Synthetic Cover Letter text.");d.save(out)',
'else:',
' c=Canvas(out,pagesize=(3000,3000) if kind=="bigpage" else (600,800));c.drawString(40,740,"Synthetic document preview");c.showPage();c.save()',
'sys.stdout.buffer.write(out.getvalue())'].join('\n'),kind],{windowsHide:true,maxBuffer:6*1024*1024});}
