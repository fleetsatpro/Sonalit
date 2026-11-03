#!/usr/bin/env bash
# Restore backend/src/app.js from main and register the spatial route.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
git fetch origin main
git checkout origin/main -- backend/src/app.js
python3 - <<'PY'
from pathlib import Path
p = Path('backend/src/app.js')
text = p.read_text()
old = '"fuel", "shifts", "traffic"]'
new = '"fuel", "shifts", "traffic", "spatial"]'
if old not in text:
    raise SystemExit('pattern not found in app.js — check manually')
if '"spatial"]' in text:
    print('spatial already present')
else:
    p.write_text(text.replace(old, new, 1))
    print('spatial route registered')
PY
# Cleanup temp restore artifacts if any
rm -f backend/src/app.part*.b64 backend/src/app.half*.json 2>/dev/null || true
echo "Done. Review and commit:"
echo "  git add backend/src/app.js && git commit -m 'fix(spatial): restore app.js + spatial route'"
