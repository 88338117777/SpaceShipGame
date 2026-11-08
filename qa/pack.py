"""Package only runtime assets, then validate the actual archive and manifest."""
from pathlib import Path
import subprocess
import zipfile
root = Path(__file__).resolve().parent.parent
out = root / 'output' / 'zero-g-hour-nine.zip'
out.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for file in sorted((root / 'game').rglob('*')):
        if file.is_file():
            z.write(file, file.relative_to(root / 'game').as_posix())
subprocess.run(['node', str(root / 'participant-delivery-kit-v3.3.2/tools/check.mjs'), str(out), str(root / 'game/global-items.json')], check=True)
print(f'{out} ({out.stat().st_size:,} bytes)')
