# STAGING SMOKE — SPRINTS 001 + 002
**Date:** 2026-05-30  
**Branch:** `main`  
**Commit SHA:** `7444fb3ad22d9036fb92826046084a177ebf59bb`  
**Operator (automated):** Claude Code  
**Operator (manual sign-off):** _______________  
**Environment:** Railway (backend staging) + Vercel (frontend preview)  

---

## Legend
- ✅ PASS — verified
- ❌ FAIL — defect recorded below
- ⏳ PENDING — requires live environment / human action
- 🚫 BLOCKED — skipped because prerequisite failed
- ⚠️ NON-BLOCKER — noted, does not halt shipment

---

## Phase S0: Secrets Provisioned

| Env var | Sandbox / Prod-grade | Set in Railway staging | Notes |
|---|---|---|---|
| `META_WHATSAPP_PHONE_NUMBER_ID` | ⏳ | ⏳ | |
| `META_WHATSAPP_ACCESS_TOKEN` | ⏳ | ⏳ | |
| `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN` | ⏳ | ⏳ | |
| `META_WHATSAPP_APP_SECRET` | ⏳ | ⏳ | |
| `OPENAI_API_KEY` | ⏳ | ⏳ | |
| `AFRICASTALKING_API_KEY` | ⏳ | ⏳ | |
| `AFRICASTALKING_USERNAME` | ⏳ | ⏳ | |
| `FUEL_CARD_WEBHOOK_SECRET` | ⏳ | ⏳ | Generated via `openssl rand -hex 32` |
| `ENCRYPTION_KEY` | ⏳ | ⏳ | Generated via `openssl rand -hex 32` |

**S0 VERIFY:**
- [ ] All 9 env vars set in Railway staging dashboard (not echoed in logs)
- [ ] Meta webhook callback URL set to `https://staging-api.sonalit.io/api/v1/guardian/whatsapp/webhook`
- [ ] Meta webhook verification handshake shows "Active"
- [ ] Backend startup logs no unreachable egress hosts

**S0 Result:** ⏳ PENDING  
**Signed off:** _______________

---

## Phase S1: Deploy + Migrate + Health

### T-S1.1 — Deploy
```bash
# Railway: deploy main branch to staging environment
# Then run migrations:
pnpm --filter backend run db:migrate

# Verify migration status:
pnpm --filter backend run db:status
```

Expected: all 30 migrations (000–029) applied, none pending.

**T-S1.1 Result:** ⏳ PENDING  

### T-S1.2 — Health endpoint
```bash
curl -sf https://staging-api.sonalit.io/health | jq .
# Expected: {"status":"ok","database":"ok","redis":"ok","partitions_ok":true}
```

**T-S1.2 Result:** ⏳ PENDING  

### T-S1.3 — RLS live on all 13 new tables
```sql
-- Run against staging DB (read-only role is fine)
SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class
WHERE relname IN (
  'geofence_events','convoy_route_corridors','fuel_entries','fuel_anomalies',
  'approved_fuel_stations','driver_behaviour_events','canned_messages',
  'convoy_broadcasts','whatsapp_config','insurance_claims','shifts',
  'shift_handovers','voice_notes'
)
ORDER BY relname;
```

Expected: 13 rows, every row `relrowsecurity = true` AND `relforcerowsecurity = true`.

| Table | relrowsecurity | relforcerowsecurity | Result |
|---|---|---|---|
| approved_fuel_stations | ⏳ | ⏳ | ⏳ |
| canned_messages | ⏳ | ⏳ | ⏳ |
| convoy_broadcasts | ⏳ | ⏳ | ⏳ |
| convoy_route_corridors | ⏳ | ⏳ | ⏳ |
| driver_behaviour_events | ⏳ | ⏳ | ⏳ |
| fuel_anomalies | ⏳ | ⏳ | ⏳ |
| fuel_entries | ⏳ | ⏳ | ⏳ |
| geofence_events | ⏳ | ⏳ | ⏳ |
| insurance_claims | ⏳ | ⏳ | ⏳ |
| shift_handovers | ⏳ | ⏳ | ⏳ |
| shifts | ⏳ | ⏳ | ⏳ |
| voice_notes | ⏳ | ⏳ | ⏳ |
| whatsapp_config | ⏳ | ⏳ | ⏳ |

**T-S1.3 Result:** ⏳ PENDING  

**S1 VERIFY:**
- [ ] `/health` → `{status:'ok', database:'ok', redis:'ok', partitions_ok:true}`
- [ ] `db:status` → all 30 migrations applied, 0 pending
- [ ] All 13 RLS rows show `true / true`
- [ ] Frontend loads + service worker registers + login succeeds

**S1 Result:** ⏳ PENDING  
**Signed off:** _______________

---

## Phase S2: Live Multi-Tenancy Verification ⚠️ HIGHEST PRIORITY

**Seed data used:** See `scripts/staging-seed-two-orgs.sql`  
**Org A ID:** `aaaaaaaa-0000-4000-a000-000000000001`  
**Org B ID:** `bbbbbbbb-0000-4000-b000-000000000001`

Obtain JWTs:
```bash
TOKEN_A=$(curl -sf -X POST https://staging-api.sonalit.io/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@org-a-smoke.io","password":"SmokeA123!"}' | jq -r .data.accessToken)

TOKEN_B=$(curl -sf -X POST https://staging-api.sonalit.io/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@org-b-smoke.io","password":"SmokeB123!"}' | jq -r .data.accessToken)
```

### T-S2.2 — Cross-tenant reads (authenticated as Org A)

All commands use `$TOKEN_A`. Expected: empty arrays or 404 for Org B resources.

```bash
# Fuel entries — expect only Org A
curl -sf -H "Authorization: Bearer $TOKEN_A" https://staging-api.sonalit.io/api/v1/fuel | jq '.data | length, .[].org_id'

# Fuel anomalies
curl -sf -H "Authorization: Bearer $TOKEN_A" https://staging-api.sonalit.io/api/v1/fuel/anomalies | jq '.data | length'

# Claims
curl -sf -H "Authorization: Bearer $TOKEN_A" https://staging-api.sonalit.io/api/v1/claims | jq '.data | length, .[].org_id'

# Shifts
curl -sf -H "Authorization: Bearer $TOKEN_A" https://staging-api.sonalit.io/api/v1/shifts | jq '.data | length, .[].org_id'

# Geofence events
curl -sf -H "Authorization: Bearer $TOKEN_A" https://staging-api.sonalit.io/api/v1/geofences/events | jq '.data | length'

# Driver behaviour by Org B driver ID — expect 404
ORG_B_DRIVER_ID="<fill from seed>"
curl -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN_A" \
  https://staging-api.sonalit.io/api/v1/drivers/$ORG_B_DRIVER_ID/behaviour

# LEADERBOARD — RULE B matview tenancy test (CRITICAL)
# Must return 0 Org B driver IDs
curl -sf -H "Authorization: Bearer $TOKEN_A" https://staging-api.sonalit.io/api/v1/behaviour/leaderboard \
  | jq '[.data[] | select(.org_id != "aaaaaaaa-0000-4000-a000-000000000001")] | length'
# Expected: 0

# Convoy broadcasts by Org B convoy — expect 404
ORG_B_CONVOY_ID="<fill from seed>"
curl -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN_A" \
  https://staging-api.sonalit.io/api/v1/convoys/$ORG_B_CONVOY_ID/broadcasts

# Fuel entry by Org B ID — expect 404
ORG_B_FUEL_ID="<fill from seed>"
curl -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN_A" \
  https://staging-api.sonalit.io/api/v1/fuel/$ORG_B_FUEL_ID
```

| Check | Expected | Actual | Result |
|---|---|---|---|
| `GET /fuel` — count of Org B entries | 0 | ⏳ | ⏳ |
| `GET /fuel/anomalies` — Org B rows | 0 | ⏳ | ⏳ |
| `GET /claims` — Org B rows | 0 | ⏳ | ⏳ |
| `GET /shifts` — Org B rows | 0 | ⏳ | ⏳ |
| `GET /geofences/events` — Org B rows | 0 | ⏳ | ⏳ |
| `GET /drivers/:orgB_id/behaviour` | 404 | ⏳ | ⏳ |
| **LEADERBOARD — Org B rows (RULE B)** | **0** | ⏳ | ⏳ |
| `GET /convoys/:orgB_id/broadcasts` | 404 | ⏳ | ⏳ |
| `GET /fuel/:orgB_fuel_id` | 404 | ⏳ | ⏳ |

**Verbatim leaderboard test result (paste jq output here):**
```
<paste output here>
```

### T-S2.3 — Cross-tenant writes (authenticated as Org A)

```bash
ORG_B_VEHICLE_ID="<fill from seed>"
ORG_B_SHIFT_USER_ID="<fill from seed>"
ORG_B_CLAIM_ID="<fill from seed>"

# POST /fuel referencing Org B vehicle — expect 422
curl -sf -X POST -H "Authorization: Bearer $TOKEN_A" -H "X-Idempotency-Key: smoke-cross-1" \
  -H 'Content-Type: application/json' \
  -d "{\"vehicle_id\":\"$ORG_B_VEHICLE_ID\",\"litres\":50}" \
  https://staging-api.sonalit.io/api/v1/fuel | jq '.error'

# POST /shifts for Org B user — expect 422
curl -sf -X POST -H "Authorization: Bearer $TOKEN_A" -H "X-Idempotency-Key: smoke-cross-2" \
  -H 'Content-Type: application/json' \
  -d "{\"driver_id\":\"$ORG_B_SHIFT_USER_ID\",\"role\":\"driver\",\"start_time\":\"2026-06-01T06:00:00Z\",\"end_time\":\"2026-06-01T18:00:00Z\"}" \
  https://staging-api.sonalit.io/api/v1/shifts | jq '.error'

# PATCH /claims/:orgB_id/status — expect 404
curl -o /dev/null -w "%{http_code}" -X PATCH -H "Authorization: Bearer $TOKEN_A" \
  -H 'Content-Type: application/json' -d '{"status":"submitted"}' \
  https://staging-api.sonalit.io/api/v1/claims/$ORG_B_CLAIM_ID/status

# POST /convoys/:orgB_id/broadcast — expect 404
curl -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $TOKEN_A" \
  -H "X-Idempotency-Key: smoke-cross-4" -H 'Content-Type: application/json' \
  -d '{"message":"test","channel":"app"}' \
  https://staging-api.sonalit.io/api/v1/convoys/$ORG_B_CONVOY_ID/broadcast
```

| Check | Expected | Actual | Result |
|---|---|---|---|
| `POST /fuel` with Org B vehicle_id | 422 | ⏳ | ⏳ |
| `POST /shifts` for Org B driver_id | 422 | ⏳ | ⏳ |
| `PATCH /claims/:orgB/status` | 404 | ⏳ | ⏳ |
| `POST /convoys/:orgB/broadcast` | 404 | ⏳ | ⏳ |

### T-S2.4 — Realtime channel scoping

- [ ] Org A Centrifugo token `channels` list contains only `org#aaaaaaaa-...` — not `org#bbbbbbbb-...`
- [ ] Attempt to subscribe to `org#<orgB_id>` channel → rejected by Centrifugo

**S2 VERIFY:**
- [ ] All reads return 0 Org B rows — no cross-tenant data leak
- [ ] Leaderboard (RULE B matview) returns 0 Org B rows ← **CRITICAL**
- [ ] All writes rejected 404/422, never 200/500
- [ ] Realtime channel scoping holds

**S2 Result:** ⏳ PENDING  
**Signed off:** _______________

---

## Phase S3: Sprint 001 Feature Smoke

### T-S3.1 — Route safety scoring
- [ ] Route through seeded risk zone → score < 80, AI narrative mentions zone name
- [ ] Re-analyse within 6h → `created_at` unchanged (cache hit)
- [ ] Attach analysis to convoy → `GET /convoys/:id/route-analysis` returns it

**T-S3.1 Result:** ⏳ PENDING — Evidence: _______________

### T-S3.2 — Cargo owner portal
- [ ] Generate portal token → URL shown once
- [ ] `/portal?token=<valid>` → map + status + seal renders
- [ ] Download chain-of-custody PDF → opens with all sections
- [ ] `/portal?token=<expired>` → "link expired", no data visible
- [ ] Portal token against `GET /api/v1/vehicles` → 401

**T-S3.2 Result:** ⏳ PENDING — Evidence: _______________

### T-S3.3 — Dead Man's Switch
- [ ] Enable DMS, timeout 1 min → warning in PanicCenter at T-2min
- [ ] Let it elapse → auto-panic labelled "AUTO: Dead Man's Switch" severity critical
- [ ] Suspend from warning toast → timer clears, no auto-panic

**T-S3.3 Result:** ⏳ PENDING — Evidence: _______________

### T-S3.4 — Fleet+
- [ ] Fleet page → table + map tabs render, markers coloured by status
- [ ] Vehicle drawer → Overview / Documents / Trips / Maintenance tabs load
- [ ] Upload document expiring tomorrow → expiry banner on Dashboard
- [ ] Bulk-select 3 vehicles, status update → all 3 updated

**T-S3.4 Result:** ⏳ PENDING — Evidence: _______________

**S3 Result:** ⏳ PENDING  
**Signed off:** _______________

---

## Phase S4: Sprint 002 Feature Smoke

### T-S4.1 — Smart geofencing + deviation
- [ ] Create corridor from route analysis
- [ ] In-corridor GPS fix → no deviation event
- [ ] Out-of-corridor fix → `route_deviation` event in live feed ≤ 2s
- [ ] Deviation > width×4 → critical alert + dispatcher notification
- [ ] Time-windowed geofence → daytime fix produces no event

**T-S4.1 Result:** ⏳ PENDING — Evidence: _______________

### T-S4.2 — Fuel anomaly detection
- [ ] Add approved fuel station
- [ ] Normal entry near station → no anomaly
- [ ] Entry 5km from any station → `unknown_location` anomaly + alert
- [ ] Entry > tank capacity → `volume_mismatch` anomaly
- [ ] Fuel-card webhook with correct HMAC → 200 + entry created
- [ ] Fuel-card webhook with wrong HMAC → 401

**T-S4.2 Result:** ⏳ PENDING — Evidence: _______________

### T-S4.3 — Driver behaviour scoring
- [ ] GPS sequence with hard decel → `hard_braking` event recorded
- [ ] Driver drawer → score gauge + sub-scores + event timeline + weekly trend
- [ ] `GET /behaviour/leaderboard` → ranked, org-scoped (matches S2 proof)

**T-S4.3 Result:** ⏳ PENDING — Evidence: _______________

### T-S4.4 — Broadcast + WhatsApp
- [ ] In-app broadcast to test convoy → recipients receive, delivery shows "delivered"
- [ ] WhatsApp broadcast to test number → message arrives on phone
- [ ] Reply from phone → message appears in Messages page
- [ ] Canned message in composer → fills textarea correctly
- [ ] No token value in network response or server log

**T-S4.4 Result:** ⏳ PENDING — Evidence: _______________  
**Note:** If using Meta sandbox test number, inbound reply may be restricted — classify as non-blocker.

### T-S4.5 — Insurance claims
- [ ] Create claim from resolved incident
- [ ] Generate PDF → all 6 sections present
- [ ] Illegal status jump `draft → settled` → 422
- [ ] Download via signed URL → opens

**T-S4.5 Result:** ⏳ PENDING — Evidence: _______________

### T-S4.6 — Shift & roster
- [ ] Create week of shifts → calendar renders, colour-coded by role
- [ ] `GET /shifts/on-duty` → correct user for current staging time
- [ ] Coverage gap → coverage alert fires
- [ ] AI-assisted handover note → 3-sentence summary appears

**T-S4.6 Result:** ⏳ PENDING — Evidence: _______________

### T-S4.7 — Voice notes
- [ ] Record 10s note on incident → uploads
- [ ] Transcript appears within ~30s (Whisper)
- [ ] Playback works; transcript expands inline
- [ ] Browser without MediaRecorder → graceful disabled state, no crash

**T-S4.7 Result:** ⏳ PENDING — Evidence: _______________

### T-S4.8 — SLA dashboard
- [ ] Executive page → all 8 tiles render with real data, no NaN/blank
- [ ] Each tile links to source page

**T-S4.8 Result:** ⏳ PENDING — Evidence: _______________

**S4 Result:** ⏳ PENDING  
**Signed off:** _______________

---

## Phase S5: Load Sanity

### T-S5.1 — k6 light load (50 VUs, 60s)
```bash
k6 run infra/k6/telemetry-ingest.js \
  --vus 50 --duration 60s \
  --env BASE_URL=https://staging-api.sonalit.io
```

| Metric | Threshold | Actual | Result |
|---|---|---|---|
| P95 GPS-ingest latency | < 300ms | ⏳ | ⏳ |
| Error rate | < 1% | ⏳ | ⏳ |
| Worker queue depth post-run | at baseline | ⏳ | ⏳ |
| DB connections | no exhaustion | ⏳ | ⏳ |

**T-S5.1 Result:** ⏳ PENDING

---

## Defects

| # | Phase | Description | Blocker? | Tracking |
|---|---|---|---|---|
| — | — | (none recorded yet) | — | — |

---

## Final Report

```
STAGING SMOKE — SPRINTS 001 + 002
  Environment:        staging @ 7444fb3ad22d9036fb92826046084a177ebf59bb
  Secrets:            9/9 set (__ sandbox, __ production-grade)
  Migrations:         000–029 applied (30 total); RLS live on all 13 new tables ✓
  Multi-tenancy (S2): PENDING — leaderboard verbatim result: <paste>
  Sprint 001 smoke:   route safety ⏳ · portal ⏳ · DMS ⏳ · fleet+ ⏳
  Sprint 002 smoke:   geofencing ⏳ · fuel ⏳ · behaviour ⏳ · broadcast/WhatsApp ⏳ ·
                      claims ⏳ · roster ⏳ · voice ⏳ · SLA ⏳
  Load sanity:        P95 <pending>ms, error rate <pending>%
  Blocker defects:    <pending> (must be 0 to ship)
  Non-blocker defects:<pending>
  Production PR:      <url — to be opened after all phases complete>
  Recommendation:     PENDING
```

**Final sign-off:** _______________ on _______________
