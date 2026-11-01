"""Reproducible extension-only ZIP; no dependencies or credentials included."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
root = Path(__file__).resolve().parents[1]
out = root / 'dist'
out.mkdir(exist_ok=True)
with ZipFile(out / 'nextprompt-v1.0.0.zip', 'w', ZIP_DEFLATED) as archive:
    for file in sorted((root / 'extension').rglob('*')):
        if file.is_file():
            info = ZipInfo(str(Path('nextprompt') / file.relative_to(root / 'extension')), (2026, 11, 2, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            archive.writestr(info, file.read_bytes())
print(out / 'nextprompt-v1.0.0.zip')
