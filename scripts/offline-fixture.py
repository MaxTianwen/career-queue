import io,json,base64,sys
from docx import Document
from reportlab.pdfgen.canvas import Canvas
from zipfile import ZipFile,ZIP_DEFLATED
req=json.load(sys.stdin)
def pair(text):
 d=Document(); d.add_paragraph(text); out=io.BytesIO();d.save(out)
 p=io.BytesIO();c=Canvas(p,pagesize=(612,792));c.setFont('Helvetica',10)
 for i,line in enumerate(text.split('\n')):c.drawString(40,740-i*14,line)
 c.showPage();c.save();return {'docx':out.getvalue(),'pdf':p.getvalue()}
if req['action']=='sources':
 result={k:base64.b64encode(pair(text)['docx']).decode() for k,text in [('cs','Synthetic Software Resume. Built verified test fixtures with Python.'),('data','Synthetic Data Resume. Analyzed sample data with SQL and Python.'),('cover','Synthetic generic cover letter. I collaborated on verified tasks.')]}
else:
 packet=ZipFile(io.BytesIO(base64.b64decode(req['base64'])));manifest=json.loads(packet.read('return-manifest.json'));out=io.BytesIO()
 with ZipFile(out,'w',ZIP_DEFLATED) as z:
  for item in manifest['items']:
   for kind in ('resume','cover'):
    text=f"Synthetic {kind} for {item['company']} {item['title']}\nVerified sample work with Python and SQL."
    for ext,data in pair(text).items():z.writestr(item['files'][kind+'_'+ext],data)
   item['changes']=[{'before':'Generic synthetic source','after':'Selected synthetic job context','reason':'Synthetic E2E fixture, not real application','source':'Synthetic source paragraph 1'}];item['unresolved']=[]
  z.writestr('return-manifest.json',json.dumps(manifest))
 result={'base64':base64.b64encode(out.getvalue()).decode()}
print(json.dumps(result))
