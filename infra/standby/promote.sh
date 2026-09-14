#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

: "${SONALIT_IMAGE:?Set SONALIT_IMAGE to the exact Git SHA image before promotion}"

echo "Promoting ${SONALIT_IMAGE}"
echo "WARNING: confirm the Railway primary is fenced/offline before continuing."

if ! curl --fail --silent --show-error --max-time 10 http://127.0.0.1:5000/health >/tmp/sonalit-standby-health-before.txt; then
  echo "Standby health check failed before promotion." >&2
  exit 1
fi

cat /tmp/sonalit-standby-health-before.txt

# Update the image but keep the service in standby while the database migration
# is checked/applied. This step should only run after the primary is confirmed
# fenced so two deploy processes cannot race on migrations.
docker compose pull

echo "Running database migrations from the exact promoted image..."
docker compose run --rm \
  -e SONALIT_STANDBY=true \
  -e ENABLE_INPROCESS_WORKERS=false \
  sonalit-standby node backend/scripts/db-migrate.js

# Replace standby role with active role. The active override enables the
# in-process workers and scheduled jobs.
docker compose down
docker compose -f docker-compose.yml -f docker-compose.active.yml up -d --remove-orphans

curl --fail --silent --show-error --retry 15 --retry-delay 3 http://127.0.0.1:5000/health >/tmp/sonalit-promoted-health.json
cat /tmp/sonalit-promoted-health.json

echo "Promotion complete. Route public traffic to this host only after the health check above passes."
