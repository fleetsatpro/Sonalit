from pathlib import Path
import re

root = Path('.')

# Backend utility already exists in this hotfix branch; keep it authoritative.

migration = root / 'backend/migrations/20260908_107_client_phone_normalization.sql'
migration.write_text('''ALTER TABLE cargo_clients\n  ADD COLUMN IF NOT EXISTS phone TEXT;\n\nCREATE INDEX IF NOT EXISTS idx_cargo_clients_phone\n  ON cargo_clients(org_id, phone)\n  WHERE deleted_at IS NULL AND phone IS NOT NULL;\n''', encoding='utf-8')

portal = root / 'backend/src/routes/portalClients.js'
text = portal.read_text(encoding='utf-8')
if "require('../utils/phone')" not in text:
    marker = "const { query } = require('../config/database');\n"
    if marker not in text:
        raise SystemExit('portal import marker missing')
    text = text.replace(marker, marker + "const { normalizePhone } = require('../utils/phone');\n", 1)

old = """  const { email, name, company } = req.body;\n  if (!email || !name) return res.status(400).json({ error: 'email and name required' });\n  const result = await req.db(\n    `INSERT INTO cargo_clients (org_id, email, name, company)\n     VALUES ($1, $2, $3, $4)\n     ON CONFLICT (org_id, email) DO UPDATE SET name = EXCLUDED.name, company = EXCLUDED.company\n     RETURNING id, org_id, email, name, company, created_at`,\n    [req.user.org_id, email.toLowerCase().trim(), name, company ?? null],\n  );\n"""
new = """  const { email, name, company, phone, country } = req.body;\n  if (!email || !name) return res.status(400).json({ error: 'email and name required' });\n  let normalizedPhone;\n  try { normalizedPhone = normalizePhone(phone, country || 'Kenya'); }\n  catch (error) { return res.status(400).json({ error: error.message || 'Enter a valid phone number.' }); }\n  const result = await req.db(\n    `INSERT INTO cargo_clients (org_id, email, name, company, phone)\n     VALUES ($1, $2, $3, $4, $5)\n     ON CONFLICT (org_id, email) DO UPDATE SET name = EXCLUDED.name, company = EXCLUDED.company, phone = EXCLUDED.phone\n     RETURNING id, org_id, email, name, company, phone, created_at`,\n    [req.user.org_id, email.toLowerCase().trim(), name, company ?? null, normalizedPhone],\n  );\n"""
if old not in text:
    raise SystemExit('portal create block mismatch; refusing unsafe patch')
portal.write_text(text.replace(old, new, 1), encoding='utf-8')

frontend = root / 'apps/web/src/pages/ClientOnboardingV3.tsx'
text = frontend.read_text(encoding='utf-8')
# The current bug is a regex literal containing two backslashes before +.
old_regex = r'/^\\+?[0-9][0-9 ()-]{6,}$/'
new_regex = r'/^\+?[0-9][0-9 ()-]{6,}$/'
count = text.count(old_regex)
if count < 2:
    raise SystemExit(f'expected both frontend phone validators, found {count}')
text = text.replace(old_regex, new_regex)
# Pass country to the backend so local numbers can be canonicalized correctly.
text = text.replace(
    "phone: form.phone.trim() });",
    "phone: form.phone.trim(), country: form.country });",
    1,
)
frontend.write_text(text, encoding='utf-8')
print(f'Patched {count} frontend phone validators and backend persistence.')
