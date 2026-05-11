#!/usr/bin/env bash
# FleetOps Pro — API smoke tests
# Fix applied: all paths use /api/v1/ (original used /api/ which returns 404)

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:5000}"
PASS=0; FAIL=0

green='\033[0;32m'; red='\033[0;31m'; gold='\033[0;33m'; nc='\033[0m'; bold='\033[1m'

check() {
  local label="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    echo -e "${green}✅ PASS${nc} — $label"
    ((PASS++))
  else
    echo -e "${red}❌ FAIL${nc} — $label (expected $expected, got $actual)"
    ((FAIL++))
  fi
}

echo -e "\n${gold}${bold}FleetOps API Smoke Tests — $BASE_URL${nc}\n"

# Health
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/health")
check "GET /health returns 200" "200" "$STATUS"

HEALTH=$(curl -s "$BASE_URL/health")
DB_OK=$(echo "$HEALTH" | grep -c '"database":"ok"' || true)
check "Health check reports database ok" "1" "$DB_OK"

# Auth — obtain token
echo -e "\n${bold}Authentication${nc}"
LOGIN=$(curl -s -X POST "$BASE_URL/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@fleetops.local","password":"password123"}')

TOKEN=$(echo "$LOGIN" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
if [[ -n "$TOKEN" ]]; then
  echo -e "${green}✅ PASS${nc} — POST /api/v1/auth/login returns token"
  ((PASS++))
else
  echo -e "${red}❌ FAIL${nc} — Login failed: $LOGIN"
  ((FAIL++))
  echo -e "\n${red}Cannot continue without token — is the server running and seeded?${nc}\n"
  exit 1
fi

# Wrong credentials
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@fleetops.local","password":"wrongpassword"}')
check "Bad password returns 401" "401" "$STATUS"

# /me
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/v1/auth/me" \
  -H "Authorization: Bearer $TOKEN")
check "GET /api/v1/auth/me returns 200" "200" "$STATUS"

# No token
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/v1/vehicles")
check "No-auth request returns 401" "401" "$STATUS"

# Vehicles
echo -e "\n${bold}Vehicles${nc}"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/v1/vehicles" \
  -H "Authorization: Bearer $TOKEN")
check "GET /api/v1/vehicles returns 200" "200" "$STATUS"

BODY=$(curl -s "$BASE_URL/api/v1/vehicles" -H "Authorization: Bearer $TOKEN")
HAS_DATA=$(echo "$BODY" | grep -c '"data"' || true)
check "Vehicles response contains data array" "1" "$HAS_DATA"

# Convoys
echo -e "\n${bold}Convoys${nc}"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/v1/convoys" \
  -H "Authorization: Bearer $TOKEN")
check "GET /api/v1/convoys returns 200" "200" "$STATUS"

# Alerts
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/v1/alerts" \
  -H "Authorization: Bearer $TOKEN")
check "GET /api/v1/alerts returns 200" "200" "$STATUS"

# Analytics
echo -e "\n${bold}Analytics${nc}"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/v1/analytics/dashboard" \
  -H "Authorization: Bearer $TOKEN")
check "GET /api/v1/analytics/dashboard returns 200" "200" "$STATUS"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/v1/analytics/fleet-utilization" \
  -H "Authorization: Bearer $TOKEN")
check "GET /api/v1/analytics/fleet-utilization returns 200" "200" "$STATUS"

# Messages
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/v1/messages/channels" \
  -H "Authorization: Bearer $TOKEN")
check "GET /api/v1/messages/channels returns 200" "200" "$STATUS"

# GPS ingestion
echo -e "\n${bold}GPS Pipeline${nc}"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/gps" \
  -H "Content-Type: application/json" \
  -d '{"vehicle_id":"00000000-0000-0000-0000-000000000001","lat":-1.2921,"lng":36.8219,"speed":85}')
# 202 = queued, 400 = invalid vehicle (acceptable — GPS route doesn't auth)
if [[ "$STATUS" == "202" || "$STATUS" == "400" ]]; then
  echo -e "${green}✅ PASS${nc} — POST /api/gps accepted (${STATUS})"
  ((PASS++))
else
  echo -e "${red}❌ FAIL${nc} — POST /api/gps returned $STATUS"
  ((FAIL++))
fi

# 404 on unknown route
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/v1/nonexistent")
check "Unknown route returns 404" "404" "$STATUS"

# Summary
echo -e "\n${bold}────────────────────────────────${nc}"
TOTAL=$((PASS + FAIL))
if [[ $FAIL -eq 0 ]]; then
  echo -e "${green}${bold}All $TOTAL tests passed ✅${nc}"
else
  echo -e "${red}${bold}$FAIL/$TOTAL tests failed ❌${nc}"
  exit 1
fi
echo ""
