"""Reproducible ZIP; run after social/brand generation and committed media updates."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
root = Path(__file__).resolve().parents[3]
public = root / 'packages/landing/public'
files = [(p, p.relative_to(public).as_posix()) for p in sorted((public/'brand').glob('*')) if p.suffix != '.zip']
files += [(public/p, p) for p in ['social/hauddy-card.png','social/hauddy-card.svg','media/demo-messages.webp','media/demo-poster.webp','mascot.png']]
files += [(root/'LICENSE','LICENSE')]
with ZipFile(public/'brand/hauddy-brand-v1.zip','w',ZIP_DEFLATED) as out:
    for file, name in files:
        info=ZipInfo('hauddy-brand-v1/'+name, (2026,9,15,0,0,0)); info.compress_type=ZIP_DEFLATED;info.external_attr=0o644 <<16
        out.writestr(info,file.read_bytes())
print('Generated versioned brand ZIP')
