"""Patch only approved text nodes; verify package fidelity and Word PDF output."""
import argparse, hashlib, json, re, unicodedata
from pathlib import Path
from zipfile import ZipFile
from lxml import etree as E
import pdfplumber

NS = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
sha = lambda data: hashlib.sha256(data).hexdigest()

def document(path):
    with ZipFile(path) as z:
        return E.fromstring(z.read('word/document.xml'))

def mask(root, edits):
    paragraphs = root.findall('.//w:p', NS)
    for edit in edits:
        nodes = paragraphs[edit['paragraph']].findall('.//w:t', NS)[edit.get('skip', 0):]
        for node in nodes:
            node.text = ''
    return E.tostring(root, method='c14n')

def verify_package(template, result, edits):
    with ZipFile(template) as before, ZipFile(result) as after:
        if before.namelist() != after.namelist():
            raise ValueError('DOCX package parts changed')
        for name in before.namelist():
            if name != 'word/document.xml' and before.read(name) != after.read(name):
                raise ValueError(f'Preserve-only part changed: {name}')
    if mask(document(template), edits) != mask(document(result), edits):
        raise ValueError('Formatting or non-editable content changed')

def patch(plan, output):
    template = Path(plan['template'])
    if sha(template.read_bytes()) != plan['templateSha256']:
        raise ValueError('Template changed; review the new version before generating')
    root = document(template)
    paragraphs = root.findall('.//w:p', NS)
    for edit in plan['edits']:
        paragraph = paragraphs[edit['paragraph']]
        old = ''.join(paragraph.xpath('.//w:t/text()', namespaces=NS))
        if old != edit['original']:
            raise ValueError('Editable slot no longer matches the pinned template')
        nodes = paragraph.findall('.//w:t', NS)[edit.get('skip', 0):]
        if not nodes or not edit['text'].strip():
            raise ValueError('Cannot clear or create an editable paragraph')
        # Every editable slot was audited as uniform body font. Keep all original
        # run/paragraph properties, including the skill label's separate bold run.
        nodes[0].text = edit['text']
        for node in nodes[1:]:
            node.text = ''
    with ZipFile(template) as src, ZipFile(output, 'x') as dest:
        for entry in src.infolist():
            data = E.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True) if entry.filename == 'word/document.xml' else src.read(entry.filename)
            dest.writestr(entry, data)
    verify_package(template, output, plan['edits'])

def compact(text):
    return re.sub(r'\s+|\u00ad', '', unicodedata.normalize('NFKC', text)).casefold()

def font_set(page):
    return {(re.sub(r'^[A-Z]{6}\+', '', c['fontname']), round(c['size'], 2)) for c in page.chars if c['text'].strip()}

def verify(plan, docx, pdf, report):
    verify_package(plan['template'], docx, plan['edits'])
    with pdfplumber.open(pdf) as generated, pdfplumber.open(plan['baselinePdf']) as baseline:
        if len(generated.pages) != 1 or len(baseline.pages) != 1:
            raise ValueError('Resume exceeds one page; fonts and margins will not be reduced')
        page, original = generated.pages[0], baseline.pages[0]
        if (page.width, page.height) != (original.width, original.height):
            raise ValueError('Page dimensions changed')
        if not font_set(page).issubset(font_set(original)):
            raise ValueError('PDF font substitution or font-size change detected')
        content = compact(page.extract_text() or '')
        if len(content) < 300:
            raise ValueError('PDF does not contain readable selectable text')
        for edit in plan['edits']:
            if compact(edit['text']) not in content:
                raise ValueError(f"Edited paragraph {edit['paragraph']} is missing or clipped in PDF")
        # Preserve-only DOCX content is structurally checked above. Also verify
        # stable names/headings/links shown in the baseline PDF remain extractable.
        for fixed in plan['fixedText']:
            if compact(fixed) not in content:
                raise ValueError('Fixed identity or section heading missing in PDF')
        for c in page.chars:
            if c['text'].strip() and (c['x0'] < 30 or c['x1'] > page.width - 30 or c['top'] < 30 or c['bottom'] > page.height - 30):
                raise ValueError('Text is outside the original page margins')
        page.to_image(resolution=120).save(Path(pdf).with_suffix('.png'))
        result = {'passed': True, 'pages': 1, 'renderer': 'Microsoft Word (read-only)',
                  'formattingUnchanged': True, 'selectableText': True, 'fontSizesUnchanged': True,
                  'templateSha256': plan['templateSha256'], 'docxSha256': sha(Path(docx).read_bytes()),
                  'pdfSha256': sha(Path(pdf).read_bytes()), 'requiresHumanReview': True}
        Path(report).write_text(json.dumps(result, indent=2), encoding='utf-8')
    if sha(Path(plan['template']).read_bytes()) != plan['templateSha256']:
        raise ValueError('Template was modified during generation')
    return result

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['patch', 'verify', 'inspect'])
    parser.add_argument('plan')
    parser.add_argument('docx')
    parser.add_argument('--pdf')
    parser.add_argument('--report')
    args = parser.parse_args()
    plan = json.loads(args.plan) if args.action == 'inspect' else json.loads(Path(args.plan).read_text(encoding='utf-8'))
    if args.action == 'inspect':
        paragraphs = document(args.docx).findall('.//w:p', NS)
        fields = []
        for slot in plan['edits']:
            nodes = paragraphs[slot['paragraph']].findall('.//w:t', NS)
            fields.append({**slot, 'original': ''.join(n.text or '' for n in nodes),
                           'text': ''.join(n.text or '' for n in nodes[slot.get('skip', 0):])})
        print(json.dumps(fields, ensure_ascii=True))
    elif args.action == 'patch':
        patch(plan, args.docx)
        print(json.dumps({'patched': True}))
    else:
        print(json.dumps(verify(plan, args.docx, args.pdf, args.report)))
