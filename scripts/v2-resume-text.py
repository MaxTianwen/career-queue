"""Extract text from supplied bytes only. Never follows document links or edits originals."""
import io
import json
import re
import sys
from zipfile import ZipFile
from lxml import etree
from pypdf import PdfReader

LIMIT = 100000


def extract(data, kind):
    pages = None
    if kind == 'docx':
        with ZipFile(io.BytesIO(data)) as archive:
            entries = archive.infolist()
            if len(entries) > 1000 or sum(e.file_size for e in entries) > 16000000:
                raise ValueError('DOCX 解压内容过大，请简化原稿后重试')
            if len({e.filename for e in entries}) != len(entries):
                raise ValueError('DOCX 包含重复文件条目')
            if any(any(s in e.filename.lower() for s in ('vbaproject', 'embeddings/', 'activex/', 'afchunk')) for e in entries):
                raise ValueError('请使用不含宏或嵌入对象的 Word 简历')
            xml = archive.read('word/document.xml')
            if len(xml) > 2000000 or b'<!DOCTYPE' in xml or b'<!ENTITY' in xml:
                raise ValueError('Word 文档结构不支持')
            root = etree.fromstring(xml, etree.XMLParser(resolve_entities=False, no_network=True))
            ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
            if root.xpath('.//w:fldChar | .//w:instrText | .//w:altChunk | .//w:del | .//w:ins', namespaces=ns):
                raise ValueError('请先将动态域转换为普通文字并接受或拒绝修订，再上传')
            text = '\n'.join(''.join(p.xpath('.//w:t/text()', namespaces=ns)) for p in root.findall('.//w:p', ns))
    elif kind == 'pdf':
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            raise ValueError('请上传未加密的 PDF')
        pages = len(reader.pages)
        if not 1 <= pages <= 10:
            raise ValueError('简历 PDF 仅支持 1–10 页')
        parts = []
        for page in reader.pages:
            content = page.get_contents()
            if content is not None and len(content.get_data()) > 2000000:
                raise ValueError('PDF 页面内容过大，请简化原稿后重试')
            parts.append(page.extract_text() or '')
            if sum(map(len, parts)) > LIMIT:
                raise ValueError('简历文字超出读取范围')
        text = '\n'.join(parts)
    else:
        raise ValueError('文件格式不支持')
    text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', ' ', text).strip()
    if len(text) > LIMIT:
        raise ValueError('简历文字超出读取范围')
    if len(re.sub(r'\s', '', text)) < 40:
        raise ValueError('没有提取到足够文字；扫描 PDF 请换为文字版 PDF 或 Word，不会使用其他简历替代')
    return {'text': text, 'pages': pages, 'parser': 'v2-text-1'}


if __name__ == '__main__':
    try:
        data = sys.stdin.buffer.read(5 * 1024 * 1024 + 1)
        if len(data) > 5 * 1024 * 1024:
            raise ValueError('文件超过 5MB')
        result = extract(data, sys.argv[1])
    except ValueError as error:
        result = {'error': str(error)}
    except Exception:
        result = {'error': '无法解析文档结构，请重新导出 PDF 或 DOCX 后上传'}
    print(json.dumps(result, ensure_ascii=True))
