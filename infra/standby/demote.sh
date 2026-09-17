#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

: "${CONFIRM_SONALIT_DEMOTION:?Set CONFIRM_SONALIT_DEMOTION=YES to demote this runtime}"
if [ "${CONFIRM_SONALIT_DEMOTION}" != "YES" ]; then
  echo "Refusing demotion: CONFIRM_SONALIT_DEMOTION must equal YES." >&2
  exit 2
fi

echo "Stopping active runtime and returning this host to fenced standby mode..."
docker compose -f docker-compose.yml -f docker-compose.active.yml down

docker compose up -d --remove-orphans

if ! curl --fail --silent --show-error --retry 15 --retry-delay 3 http://127.0.0.1:5000/health >/tmp/sonalit-demoted-health.json; then
  echo "Standby runtime failed health checks after demotion." >&2
  docker compose logs --tail=120 || true
  exit 1
fi

cat /tmp/sonalit-demoted-health.json
echo "Host is back in standby mode."
