import importlib.util, json, unittest, uuid
from pathlib import Path
from zipfile import ZipFile
from reportlab.pdfgen import canvas

root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('resume_document', root/'scripts/resume_document.py')
engine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine)

class DocumentGuards(unittest.TestCase):
    def setUp(self):
        self.folder = root/'output/test-runs'/str(uuid.uuid4())
        self.folder.mkdir(parents=True)
        self.template = self.folder/'template.docx'
        xml = b'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>Original synthetic content</w:t></w:r></w:p></w:body></w:document>'
        with ZipFile(self.template, 'x') as z:
            z.writestr('word/document.xml', xml)
            z.writestr('word/styles.xml', b'<preserve-only/>')
        self.plan = {'template': str(self.template), 'templateSha256': engine.sha(self.template.read_bytes()),
                     'edits':[{'paragraph':0,'original':'Original synthetic content','text':'SQL synthetic content'}],
                     'fixedText':[], 'baselinePdf':str(self.folder/'baseline.pdf')}
        self.output = self.folder/'resume.docx'
        engine.patch(self.plan, self.output)

    def pdf(self, path, pages=1, size=10, x=40):
        c = canvas.Canvas(str(path), pagesize=(612,792))
        for i in range(pages):
            c.setFont('Times-Roman', size)
            c.drawString(x,700,'SQL synthetic content')
            for row in range(10): c.drawString(40,680-row*15, 'Readable synthetic test content for layout verification only.')
            c.showPage()
        c.save()

    def test_source_unchanged_and_format_tampering_detected(self):
        self.assertEqual(engine.sha(self.template.read_bytes()), self.plan['templateSha256'])
        tampered = self.folder/'tampered.docx'
        with ZipFile(self.output) as source, ZipFile(tampered,'x') as target:
            for name in source.namelist():
                data = source.read(name)
                target.writestr(name, data.replace(b'w:val="20"',b'w:val="18"') if name=='word/document.xml' else data)
        with self.assertRaisesRegex(ValueError,'Formatting'): engine.verify_package(self.template,tampered,self.plan['edits'])

    def test_multi_page_rejected(self):
        self.pdf(self.plan['baselinePdf'])
        self.pdf(self.folder/'resume.pdf',pages=2)
        with self.assertRaisesRegex(ValueError,'one page'): engine.verify(self.plan,self.output,self.folder/'resume.pdf',self.folder/'report.json')
        self.assertFalse((self.folder/'report.json').exists())

    def test_font_shrinking_rejected(self):
        self.pdf(self.plan['baselinePdf'])
        self.pdf(self.folder/'resume.pdf',size=8)
        with self.assertRaisesRegex(ValueError,'font'): engine.verify(self.plan,self.output,self.folder/'resume.pdf',self.folder/'report.json')

    def test_overflow_rejected(self):
        self.pdf(self.plan['baselinePdf'])
        self.pdf(self.folder/'resume.pdf',x=10)
        with self.assertRaisesRegex(ValueError,'margins'): engine.verify(self.plan,self.output,self.folder/'resume.pdf',self.folder/'report.json')

if __name__ == '__main__': unittest.main()
