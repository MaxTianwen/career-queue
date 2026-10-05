"""Build a portable account archive without original filenames becoming paths."""
import base64
import io
import json
import sys
from zipfile import ZipFile, ZIP_DEFLATED

data = json.loads(sys.stdin.buffer.read(64 * 1024 * 1024 + 1))
out = io.BytesIO()
with ZipFile(out, 'w', compression=ZIP_DEFLATED) as archive:
    for file in data['files']:
        payload = base64.b64decode(file.pop('base64'), validate=True)
        archive.writestr(file['archivePath'], payload)
    archive.writestr('records.json', json.dumps(data, ensure_ascii=False, indent=2))
    archive.writestr('README.txt', 'Career Queue personal export\nrecords.json contains your saved records and file names.\nfiles/ contains unchanged originals referenced by archivePath.\nThis export excludes login credentials and cannot be imported as a workspace backup.\n')
sys.stdout.buffer.write(out.getvalue())
