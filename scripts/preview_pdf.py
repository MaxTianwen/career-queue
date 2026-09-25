"""Render an existing local PDF page without modifying the source document."""
import base64
import io
import json
import sys
import pdfplumber

with pdfplumber.open(sys.argv[1]) as pdf:
    page = int(sys.argv[2])
    if not 1 <= page <= len(pdf.pages) <= 200:
        raise ValueError('Invalid page or PDF exceeds 200 pages')
    image = pdf.pages[page - 1].to_image(resolution=144).original
    data = io.BytesIO()
    image.save(data, format='PNG')
    print(json.dumps({'pages': len(pdf.pages), 'page': page,
                     'image': 'data:image/png;base64,' + base64.b64encode(data.getvalue()).decode('ascii')}))
