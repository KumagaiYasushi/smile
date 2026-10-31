"""Create a source-only review archive; never include local data or credentials."""
from pathlib import Path
import zipfile
import hashlib

root = Path(__file__).resolve().parents[1]
output = root / 'data' / 'reports' / 'smile-review.zip'
output.parent.mkdir(parents=True, exist_ok=True)
directories = ['app', 'components', 'lib', 'types', 'public', 'docs', 'scripts', 'tests', '.github']
files = ['package.json', 'package-lock.json', 'tsconfig.json', 'next.config.ts', 'eslint.config.mjs', 'postcss.config.mjs', 'proxy.ts', 'README.md', 'AGENTS.md', 'CLAUDE.md', '.gitignore']
paths = [root / name for name in files]
for directory in directories:
    paths.extend(path for path in (root / directory).rglob('*') if path.is_file())
paths.extend(root.glob('*仕様書*.md'))
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(set(paths)):
        relative = path.relative_to(root)
        if path.is_symlink() or any(part in ['data', '.git', '.next', 'node_modules', '__pycache__'] or part.startswith('.env') for part in relative.parts):
            raise RuntimeError('Unexpected runtime/secret path in source archive')
        archive.write(path, 'smile-review/' + relative.as_posix())
with zipfile.ZipFile(output) as archive:
    assert archive.testzip() is None
    assert len(archive.namelist()) == len(paths)
print(f'{output} ({output.stat().st_size} bytes)')
print('SHA256 ' + hashlib.sha256(output.read_bytes()).hexdigest())
