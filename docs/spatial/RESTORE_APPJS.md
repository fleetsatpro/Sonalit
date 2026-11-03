# CRITICAL: Restore backend/src/app.js before merge

The feature branch temporarily has a broken `backend/src/app.js` (loader stub).

## One-line fix (preferred)

```bash
git fetch origin main
git checkout origin/main -- backend/src/app.js
```

Then edit the route forEach list:

```diff
-  "fuel", "shifts", "traffic"]
+  "fuel", "shifts", "traffic", "spatial"]
```

Commit:

```bash
git add backend/src/app.js
git commit -m "fix(spatial): restore app.js and register spatial route"
git push
```

## Cleanup of temporary files

Remove if present:

- `backend/src/app.part0.b64` … `app.part3.b64`
- `backend/src/app.half0.json` …

## Verify

```bash
grep -n spatial backend/src/app.js
# should show spatial inside the forEach route array
node -e "require('./backend/src/app.js'); console.log('load ok')"
```
