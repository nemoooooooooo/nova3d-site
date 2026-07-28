#!/usr/bin/env bash
# Build ./dist — exactly the files index.html references, nothing else — then
# deploy that. Deploying the repo root would risk shipping .git, the stale
# "Nova3D Site.dc.html" snapshot, and ~4.7 MB of assets nothing links to.
#
#   ./publish.sh            build dist/ only
#   ./publish.sh --deploy   build dist/ and push it to Cloudflare Pages
#
# Requires (once): either `npx wrangler login`, or an API token in the env:
#   export CLOUDFLARE_API_TOKEN=...   # "Cloudflare Pages — Edit" permission
set -euo pipefail
cd "$(dirname "$0")"

PROJECT="${PAGES_PROJECT:-nova3d-site}"
rm -rf dist && mkdir -p dist

cp index.html support.js nova-viewer.js dist/

# Copy only referenced assets, read straight out of the shipped sources.
python3 - <<'PY'
import re, pathlib, shutil
root = pathlib.Path('.')
srcs = ['index.html', 'support.js', 'nova-viewer.js']
text = '\n'.join((root / s).read_text(encoding='utf-8', errors='ignore') for s in srcs)
refs = sorted(set(re.findall(r'assets/[A-Za-z0-9_./-]+\.(?:glb|webp|mp4|webm|png|jpg|svg|json|html|js)', text)))
# the embedded dragon demo is its own little page: pull in whatever it references too
for r in list(refs):
    if r.endswith('.html'):
        sub = (root / r)
        if sub.exists():
            t2 = sub.read_text(encoding='utf-8', errors='ignore')
            base = str(pathlib.Path(r).parent)
            for m in re.findall(r"['\"]\./([A-Za-z0-9_.-]+\.(?:glb|js|css|png|webp))['\"]", t2):
                refs.append(base + '/' + m)
refs = sorted(set(refs))
missing, total = [], 0
for r in refs:
    src = root / r
    if not src.exists():
        missing.append(r); continue
    dst = root / 'dist' / r
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    total += src.stat().st_size
print(f'  {len(refs)-len(missing)} assets copied ({total/1e6:.1f} MB)')
if missing:
    raise SystemExit('  MISSING referenced assets: ' + ', '.join(missing))
PY

echo "  dist/ ready — $(du -sh dist | cut -f1)"

if [ "${1:-}" = "--deploy" ]; then
  # no directory arg: wrangler.toml's pages_build_output_dir="dist" drives it
  npx wrangler pages deploy --project-name "$PROJECT" --commit-dirty=true
fi
