"""Render uploaded PDF bytes to passive images; never change or execute the original."""
import base64
import io
import json
import sys
import pypdfium2 as pdfium

try:
    data = sys.stdin.buffer.read(5 * 1024 * 1024 + 1)
    if len(data) > 5 * 1024 * 1024:
        raise ValueError('PDF 超过 5MB')
    pdf = pdfium.PdfDocument(data)
    if not 1 <= len(pdf) <= 10:
        raise ValueError('材料 PDF 仅支持 1–10 页')
    images = []
    for index in range(len(pdf)):
        page = pdf[index]
        width, height = page.get_size()
        if not 0 < width <= 2000 or not 0 < height <= 2000:
            raise ValueError('PDF 页面尺寸不支持')
        scale = min(1.5, 1400 / max(width, height))
        bitmap = page.render(scale=scale)
        output = io.BytesIO()
        bitmap.to_pil().save(output, format='PNG')
        images.append(base64.b64encode(output.getvalue()).decode('ascii'))
        bitmap.close()
        page.close()
    pdf.close()
    result = {'pages': len(images), 'images': images}
except ValueError as error:
    result = {'error': str(error)}
except Exception:
    result = {'error': '无法预览 PDF，请使用未加密的有效 PDF 文件'}
print(json.dumps(result))
