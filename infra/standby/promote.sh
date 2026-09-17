#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

: "${SONALIT_IMAGE:?Set SONALIT_IMAGE to the exact Git SHA image before promotion}"
: "${CONFIRM_SONALIT_FAILOVER:?Set CONFIRM_SONALIT_FAILOVER=YES to acknowledge primary fencing}"

if [ "${CONFIRM_SONALIT_FAILOVER}" != "YES" ]; then
  echo "Refusing promotion: CONFIRM_SONALIT_FAILOVER must equal YES." >&2
  exit 2
fi

EXPECTED_REVISION="${SONALIT_EXPECTED_REVISION:-}"

echo "Promoting ${SONALIT_IMAGE}"
echo "Primary fencing has been explicitly acknowledged."

if ! curl --fail --silent --show-error --max-time 10 http://127.0.0.1:5000/health >/tmp/sonalit-standby-health-before.json; then
  echo "Standby health check failed before promotion." >&2
  exit 1
fi
cat /tmp/sonalit-standby-health-before.json

echo "Pulling the exact standby image..."
docker compose pull

DIGEST="$(docker image inspect "${SONALIT_IMAGE}" --format '{{index .RepoDigests 0}}' 2>/dev/null || true)"
if [ -z "$DIGEST" ]; then
  echo "Could not resolve an image digest for ${SONALIT_IMAGE}. Refusing promotion." >&2
  exit 1
fi
echo "Resolved image: ${DIGEST}"

if [ -n "$EXPECTED_REVISION" ]; then
  ACTUAL_REVISION="$(docker image inspect "${SONALIT_IMAGE}" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null || true)"
  if [ "$ACTUAL_REVISION" != "$EXPECTED_REVISION" ]; then
    echo "Image revision mismatch: expected ${EXPECTED_REVISION}, got ${ACTUAL_REVISION:-missing}." >&2
    exit 1
  fi
  echo "Image revision verified: ${ACTUAL_REVISION}"
fi

# Keep the process fenced as standby while migrations run. This prevents jobs
# and scheduled side effects from starting during schema work.
echo "Running database migrations from the exact promoted image..."
docker compose run --rm \
  -e SONALIT_STANDBY=true \
  -e ENABLE_INPROCESS_WORKERS=false \
  -e SONALIT_FENCE_TAKEOVER=false \
  sonalit-standby node backend/scripts/db-migrate.js

# Promotion is the only path that enables takeover. The database-backed runtime
# fence will evict any stale/remaining active owner on its next heartbeat.
echo "Switching standby container into active role..."
docker compose down
SONALIT_FENCE_TAKEOVER=true docker compose -f docker-compose.yml -f docker-compose.active.yml up -d --remove-orphans

if ! curl --fail --silent --show-error --retry 20 --retry-delay 3 http://127.0.0.1:5000/health >/tmp/sonalit-promoted-health.json; then
  echo "Promoted runtime failed health checks." >&2
  docker compose logs --tail=120 || true
  exit 1
fi

cat /tmp/sonalit-promoted-health.json

echo "Runtime promotion succeeded. Route public traffic to this host only after verifying the primary is fenced."
