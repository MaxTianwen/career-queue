"""Bounded, in-memory ZIP/document inspection. No archive member is extracted to disk."""
import base64, io, json, re, sys, hashlib, stat, posixpath
from urllib.parse import unquote
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree
from pypdf import PdfReader
import pypdf.filters
import pypdfium2 as pdfium
pypdf.filters.ZLIB_MAX_OUTPUT_LENGTH = 8 * 1024 * 1024
MB = 1024 * 1024

class SecurityError(ValueError): pass
class DocumentError(ValueError): pass
def unique_object(pairs):
    result={}
    for key,value in pairs:
        if key in result: raise SecurityError('JSON重复字段')
        result[key]=value
    return result
def entries(data, docx=False):
    z=ZipFile(io.BytesIO(data)); rows=z.infolist()
    if len(rows) > (1000 if docx else 32): raise SecurityError('ZIP条目数量超限')
    names=[r.filename for r in rows]
    if len(set(n.casefold() for n in names)) != len(names): raise SecurityError('ZIP重复路径')
    if sum(r.file_size for r in rows) > (16 if docx else 25)*MB: raise SecurityError('ZIP解压总量超限')
    for r in rows:
        n=r.filename
        if len(n)>220 or n.startswith('/') or '\\' in n or ':' in n or any(s in ('','..','.') for s in n.rstrip('/').split('/')) or any(ord(c)<32 for c in n): raise SecurityError('ZIP路径不安全')
        if r.flag_bits & 1 or stat.S_ISLNK(r.external_attr >> 16): raise SecurityError('ZIP加密或链接条目不支持')
        if r.file_size > (8 if docx else 5)*MB or r.file_size>max(1,r.compress_size)*200: raise SecurityError('ZIP压缩膨胀超限')
    return z,rows
def xml(data):
    if len(data)>2*MB or b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper(): raise SecurityError('XML结构不安全')
    return etree.fromstring(data,etree.XMLParser(resolve_entities=False,no_network=True,huge_tree=False))
def inspect(data,kind):
    if not data or len(data)>5*MB: raise SecurityError('单个文档超过5MB或为空')
    if kind=='docx':
        z,rows=entries(data,True); links=[]
        for r in rows:
            n=r.filename.lower()
            if any(s in n for s in ('vbaproject','embeddings/','activex/','afchunk')): raise SecurityError('拒绝宏、嵌入对象和动态内容')
            if n.endswith(('.xml','.rels')):
                body=z.read(r); tree=xml(body)
                if b'macroenabled' in body.lower(): raise SecurityError('拒绝宏文档')
                for node in tree.iter():
                    local=etree.QName(node).localname
                    if local in ('fldChar','instrText','altChunk','object','oleObject','ins','del'): raise SecurityError('拒绝动态域、对象或未处理修订')
                    if local=='Relationship' and node.get('TargetMode')=='External':
                        target=node.get('Target','')
                        if not node.get('Type','').endswith('/hyperlink') or not re.match(r'^(https://|mailto:)[^\s]+$',target): raise SecurityError('拒绝外部模板、文件或非安全链接')
                        links.append(target)
                    elif local=='Relationship':
                        target=unquote(node.get('Target',''))
                        if target.startswith('#'): continue
                        if ':' in target or '\\' in target or target.startswith('/'): raise SecurityError('Word内部关系不能指向外部路径')
                        parent=r.filename.split('/_rels/')[0] if '/_rels/' in r.filename else ''
                        destination=posixpath.normpath(posixpath.join(parent,target))
                        if destination.startswith('../') or destination not in z.namelist(): raise SecurityError('Word关系路径无效')
        tree=xml(z.read('word/document.xml')); ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
        text='\n'.join(''.join((n.text or '') if etree.QName(n).localname=='t' else ' ' if etree.QName(n).localname in ('br','cr','tab') else '' for n in p.iter()) for p in tree.findall('.//w:p',ns))
        styles=[]
        for name in ('word/styles.xml','word/numbering.xml'):
            if name in z.namelist(): styles.append(hashlib.sha256(z.read(name)).hexdigest())
        styles += [etree.tostring(n).decode() for n in tree.xpath('//w:sectPr|//w:rFonts|//w:sz',namespaces=ns)]
        result={'pages':None,'styleFingerprint':hashlib.sha256(json.dumps(styles).encode()).hexdigest(),'links':links,'wordRendered':False}
    elif kind=='pdf':
        reader=PdfReader(io.BytesIO(data),strict=True)
        if reader.is_encrypted: raise SecurityError('拒绝加密PDF')
        seen=set(); count=[0]
        def walk(obj,depth=0):
            if depth>30: raise SecurityError('PDF对象深度超限')
            if hasattr(obj,'idnum'):
                key=(obj.idnum,obj.generation)
                if key in seen:return
                seen.add(key); obj=obj.get_object()
            count[0]+=1
            if count[0]>15000: raise SecurityError('PDF对象数量超限')
            if isinstance(obj,dict):
                if any(k in obj for k in ('/JS','/JavaScript','/Launch','/EmbeddedFiles','/EmbeddedFile','/OpenAction','/AA','/RichMedia','/XFA','/AcroForm','/Filespec')): raise SecurityError('PDF含脚本、表单、附件或自动动作')
                if '/S' in obj and (str(obj.get('/Type'))=='/Action' or str(obj['/S']) in ('/JavaScript','/Launch','/GoToR','/SubmitForm','/ImportData','/Rendition','/Sound','/Movie')) and str(obj['/S']) not in ('/URI','/GoTo'): raise SecurityError('PDF动作不支持')
                if '/Next' in obj or str(obj.get('/Subtype')) in ('/FileAttachment','/RichMedia','/Movie','/Sound'): raise SecurityError('PDF附件或动作链不支持')
                if '/A' in obj:
                    action=obj['/A'].get_object()
                    if not isinstance(action,dict) or str(action.get('/S')) not in ('/URI','/GoTo'): raise SecurityError('PDF交互动作不支持')
                if '/F' in obj and not isinstance(obj['/F'],(int,float)): raise SecurityError('PDF外部数据不支持')
                if '/URI' in obj and not re.match(r'^(https://|mailto:)[^\s]+$',str(obj['/URI'])): raise SecurityError('PDF外部链接不安全')
                for k,v in obj.items():
                    if k!='/Parent':walk(v,depth+1)
            elif isinstance(obj,list):
                for v in obj:walk(v,depth+1)
        walk(reader.trailer)
        if len(reader.pages)!=1: raise DocumentError('PDF必须实际为1页')
        page=reader.pages[0]
        if page.get_contents() and len(page.get_contents().get_data())>2*MB: raise SecurityError('PDF内容流超限')
        doc=pdfium.PdfDocument(data)
        if len(doc)!=1: raise DocumentError('PDF页数交叉校验失败')
        rendered=doc[0]; w,h=rendered.get_size()
        if not 0<w<=2000 or not 0<h<=2000: raise SecurityError('PDF页面尺寸超限')
        bitmap=rendered.render(scale=0.5); bitmap.close();rendered.close();doc.close()
        text=page.extract_text() or ''; result={'pages':1,'rendered':True}
    else: raise SecurityError('只支持DOCX/PDF')
    if not text.strip() or len(text)>100000: raise DocumentError('文档文字为空或过长')
    return {**result,'text':text,'sha256':hashlib.sha256(data).hexdigest()}
try:
    raw=sys.stdin.buffer.read(45*MB+1)
    if len(raw)>45*MB: raise SecurityError('请求超限')
    request=json.loads(raw)
    if request['action']=='inspect':
        result=inspect(base64.b64decode(request['base64'],validate=True),request['kind'])
    elif request['action']=='pack':
        out=io.BytesIO()
        with ZipFile(out,'w',ZIP_DEFLATED) as z:
            for item in request['files']:z.writestr(item['path'],base64.b64decode(item['base64'],validate=True))
        result={'base64':base64.b64encode(out.getvalue()).decode()}
    elif request['action']=='unpack':
        data=base64.b64decode(request['base64'],validate=True)
        if len(data)>25*MB:raise SecurityError('ZIP超过25MB')
        z,rows=entries(data)
        if 'return-manifest.json' not in z.namelist():raise SecurityError('缺少return-manifest.json')
        if z.getinfo('return-manifest.json').file_size>128*1024:raise SecurityError('清单超过128KB')
        result={'manifest':json.loads(z.read('return-manifest.json'),object_pairs_hook=unique_object),'files':[]}
        for r in rows:
            if r.is_dir() or r.filename=='return-manifest.json':continue
            kind=r.filename.split('.')[-1].lower()
            data=z.read(r)
            if kind not in ('docx','pdf'): raise SecurityError('只支持DOCX/PDF')
            try:
                inspection=inspect(data,kind)
                result['files'].append({'path':r.filename,'base64':base64.b64encode(data).decode(),'inspection':inspection})
            except SecurityError: raise
            except Exception as error:
                result['files'].append({'path':r.filename,'error':str(error) if isinstance(error,DocumentError) else '文档结构损坏/不支持'})
    else:raise SecurityError('不支持的操作')
except Exception as error:
    result={'error':str(error) if isinstance(error,ValueError) else '文档或ZIP结构损坏/不支持'}
print(json.dumps(result,ensure_ascii=True))
