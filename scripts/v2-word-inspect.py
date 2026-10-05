"""Validate the entire package before passing an uploaded document to Word."""
import importlib.util
import json
import sys
from pathlib import Path
from zipfile import ZipFile
from lxml import etree as E
from resume_base import inspect_docx

spec = importlib.util.spec_from_file_location('reader', Path(__file__).with_name('v2-resume-text.py'))
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)

try:
    path = Path(sys.argv[1])
    reader.extract(path.read_bytes(), 'docx')
    with ZipFile(path) as archive:
        for entry in archive.infolist():
            if entry.filename.lower().endswith(('.xml', '.rels')):
                data = archive.read(entry)
                if b'<!DOCTYPE' in data or b'<!ENTITY' in data:
                    raise ValueError('文档含不支持的 XML 声明')
                root = E.fromstring(data, E.XMLParser(resolve_entities=False, no_network=True))
                if root.getroottree().docinfo.doctype:
                    raise ValueError('文档含不支持的 XML 声明')
                if entry.filename.lower().endswith('.rels'):
                    for rel in root:
                        if rel.get('TargetMode') == 'External' and not rel.get('Type', '').endswith('/hyperlink'):
                            raise ValueError('请移除外部模板或内容引用后上传')
                if root.xpath('//*[local-name()="fldChar" or local-name()="instrText" or local-name()="altChunk" or local-name()="ins" or local-name()="del"]'):
                    raise ValueError('请先转换动态域并处理文档修订')
    print(json.dumps(inspect_docx(path), ensure_ascii=True))
except Exception:
    print(json.dumps({'error': 'Word 结构暂不支持；请移除动态域、修订、嵌入对象或外部模板后重新上传'}, ensure_ascii=True))
