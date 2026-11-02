"""Reproducible extension-only ZIP; no dependencies or credentials included."""
import json
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
root = Path(__file__).resolve().parents[1]
version = json.loads((root / 'extension/manifest.json').read_text())['version']
filename = f'nextprompt-v{version}.zip'
out = root / 'dist'
out.mkdir(exist_ok=True)
with ZipFile(out / filename, 'w', ZIP_DEFLATED) as archive:
    for file in sorted((root / 'extension').rglob('*')):
        if file.is_file():
            info = ZipInfo(str(Path('nextprompt') / file.relative_to(root / 'extension')), (2026, 11, 2, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            archive.writestr(info, file.read_bytes())
    info = ZipInfo('INSTALL.txt', (2026, 11, 2, 0, 0, 0))
    info.compress_type = ZIP_DEFLATED
    archive.writestr(info, (root / 'docs/INSTALL.txt').read_bytes())
print(out / filename)
