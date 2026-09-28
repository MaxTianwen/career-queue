"""Inspect an uploaded baseline without changing its content or formatting."""
import json, re, sys, hashlib
from pathlib import Path
from zipfile import ZipFile
from lxml import etree as E
import pdfplumber

NS = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
W = '{' + NS['w'] + '}'
PARSER = E.XMLParser(resolve_entities=False, no_network=True)


def inspect_docx(path):
    with ZipFile(path) as z:
        entries = z.infolist()
        if len(entries) > 1500 or sum(e.file_size for e in entries) > 40 * 1024 * 1024:
            raise ValueError('DOCX 解压后过大')
        for entry in entries:
            name = entry.filename.lower()
            if any(x in name for x in ['vbaproject', 'embeddings/', 'activex/', 'afchunk']):
                raise ValueError('请上传不含宏、嵌入对象或外部文档的 DOCX')
            if name.endswith('.rels'):
                relations = E.fromstring(z.read(entry), PARSER)
                for rel in relations:
                    if rel.get('TargetMode') == 'External' and not rel.get('Type', '').endswith('/hyperlink'):
                        raise ValueError('DOCX 含外部内容引用，请移除后上传')
        root = E.fromstring(z.read('word/document.xml'), PARSER)
        if root.xpath('.//w:fldChar | .//w:instrText | .//w:altChunk', namespaces=NS):
            raise ValueError('DOCX 含动态域或外部内容，请转换为普通文字后上传')
        styles = E.fromstring(z.read('word/styles.xml'), PARSER) if 'word/styles.xml' in z.namelist() else None
    bullet_styles = set()
    if styles is not None:
        for s in styles.findall('w:style', NS):
            name = s.find('w:name', NS)
            if s.find('.//w:numPr', NS) is not None or (name is not None and 'list bullet' in name.get(W + 'val', '').lower()):
                bullet_styles.add(s.get(W + 'styleId'))
    sections = {
        'summary': r'(summary(?: of qualifications)?|profile|professional summary|objective|个人简介|求职摘要)',
        'skills': r'(skills|technical skills|technical proficiencies|技能|专业技能)',
        'experience': r'((?:work |professional |relevant )?experience|employment(?: history)?|工作经历|实习经历)',
        'projects': r'((?:technical |academic |selected |personal )?projects|项目经历|项目)',
        'education': r'(education|education and certifications|教育背景|教育经历)',
    }
    section = None
    slots, groups, current = [], [], []
    last_signature = None
    for i, p in enumerate(root.findall('.//w:p', NS)):
        text = ''.join(p.xpath('.//w:t/text()', namespaces=NS))
        heading = text.strip().strip(':：').casefold()
        found = next((key for key, pattern in sections.items() if re.fullmatch(pattern, heading)), None)
        if found:
            section = found
        style = p.find('w:pPr/w:pStyle', NS)
        bullet = p.find('w:pPr/w:numPr', NS) is not None or (style is not None and style.get(W + 'val') in bullet_styles)
        runs = [r for r in p.findall('w:r', NS) if r.find('w:t', NS) is not None]
        signatures = [E.tostring(r.find('w:rPr', NS)) if r.find('w:rPr', NS) is not None else b'' for r in runs]
        # Text-only, uniformly styled, direct body paragraphs. Tables, links,
        # mixed bold spans, identities and unknown sections stay untouched.
        safe = (p.getparent().tag == W + 'body' and bool(runs) and len(set(signatures)) == 1
                and all(c.tag in {W + 'pPr', W + 'r'} for c in p)
                and all(c.tag in {W + 'rPr', W + 't'} for r in runs for c in r)
                and len(p.findall('.//w:r', NS)) == len(runs)
                and section in {'summary', 'skills', 'experience', 'projects'} and not found
                and len(text.strip()) >= 25 and (bullet or section == 'summary'))
        signature = (section, E.tostring(p.find('w:pPr', NS)) if p.find('w:pPr', NS) is not None else b'', signatures[0] if signatures else b'')
        if not safe or not bullet or signature != last_signature:
            if len(current) > 1:
                groups.append(current)
            current = []
        if safe:
            slots.append({'paragraph': i, 'original': text, 'label': f'{section} · {len(slots) + 1}'})
            if bullet:
                current.append(i)
        last_signature = signature if safe and bullet else None
    if len(current) > 1:
        groups.append(current)
    editable = {s['paragraph'] for s in slots}
    fixed = [''.join(p.xpath('.//w:t/text()', namespaces=NS)) for i, p in enumerate(root.findall('.//w:p', NS)) if i not in editable]
    return {'slots': slots, 'groups': groups, 'fixedText': [text for text in fixed if text.strip()],
            'note': '仅在同一经历内重排格式一致的相邻要点；不新增技能或改写事实。其他内容原样保留。'}


def inspect_pdf(path):
    with pdfplumber.open(path) as pdf:
        if not pdf.pages or len(pdf.pages) > 20:
            raise ValueError('PDF 须为 1–20 页')
        return {'pages': len(pdf.pages), 'readable': len(re.sub(r'\s', '', ''.join(p.extract_text() or '' for p in pdf.pages))) >= 300}


def resume_text(path):
    with pdfplumber.open(path) as pdf:
        if not pdf.pages or len(pdf.pages) > 20:
            raise ValueError('PDF 须为 1–20 页')
        text = '\n'.join(p.extract_text() or '' for p in pdf.pages)
        if len(text) > 100000:
            raise ValueError('简历文字超过读取限制')
        return {'text': text}


if __name__ == '__main__':
    action, path = sys.argv[1:]
    result = inspect_docx(Path(path)) if action == 'docx' else resume_text(Path(path)) if action == 'text' else inspect_pdf(Path(path))
    print(json.dumps(result, ensure_ascii=True))
