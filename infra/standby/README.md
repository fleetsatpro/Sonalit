# Sonalit Free Standby Backend

This directory provides a provider-independent disaster-recovery replica for the Sonalit legacy monolith.

## Design

- Railway remains the primary backend.
- The standby is a single Docker container on a free/low-cost VPS (Oracle Cloud Free Tier is a suitable target).
- Both instances use the same Git commit/image and the same authoritative Neon/Postgres database.
- The standby uses the same Redis service when the application requires Redis.
- `SONALIT_STANDBY=true` disables every `node-cron` schedule in the monolith and keeps in-process workers disabled.
- The standby is therefore safe to keep running without duplicating report generation, intelligence sweeps, retention, GDPR purge, or other scheduled side effects.
- Promotion is an explicit operation. Do not point public traffic at both instances unless a proper health-based routing layer is configured.

## Host requirements

A small Linux VM with Docker and Docker Compose is enough. The application container listens only on `127.0.0.1:5000` so the host can later put Caddy/Nginx/Cloudflare Tunnel in front of it.

## First-time setup

1. Create the VM and install Docker + Compose.
2. Create `/opt/sonalit-standby`.
3. Copy `docker-compose.yml` and `.env.example` to that directory and rename `.env.example` to `.env`.
4. Put the real production `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `CORS_ORIGINS`, and all API integration secrets required by the backend into `.env`.
5. Make sure `SONALIT_STANDBY=true` and `ENABLE_INPROCESS_WORKERS=false` remain set.
6. Authenticate to GHCR (or make the package public) and start the container:

```bash
cd /opt/sonalit-standby
docker compose pull
docker compose up -d
docker compose ps
curl --fail http://127.0.0.1:5000/health
```

## CI/CD

`.github/workflows/standby-backend.yml` builds `Dockerfile.standby` and publishes an immutable image tagged with the Git SHA plus the `standby` tag.

To enable automatic deployment to the standby host, configure these GitHub Actions secrets:

- `STANDBY_SSH_HOST`
- `STANDBY_SSH_USER`
- `STANDBY_SSH_KEY`
- `STANDBY_SSH_PORT` (optional; defaults to `22`)

The workflow is deliberately safe when those secrets are absent: it still builds and publishes the standby image, but skips the SSH deployment job.

## Promotion

Promotion is deliberately manual until a real health-based routing layer is configured. This prevents a network partition from causing split-brain traffic.

First verify the primary is genuinely unavailable and the standby can reach the authoritative database/Redis. Then on the standby host:

```bash
cd /opt/sonalit-standby

# Replace this with the exact image SHA you intend to promote.
export SONALIT_IMAGE=ghcr.io/fleetsatpro/sonalit-backend:<git-sha>

docker compose pull

# Stop the standby role and start the promoted role.
docker compose down
docker compose -f docker-compose.yml -f docker-compose.active.yml up -d --remove-orphans

curl --fail http://127.0.0.1:5000/health
```

The active override sets `SONALIT_STANDBY=false` and `ENABLE_INPROCESS_WORKERS=true`.

Before promotion, update DNS/reverse-proxy origin routing to the standby host. After primary recovery, reverse the routing and return the standby to its default `SONALIT_STANDBY=true` state before bringing the primary back into service.

## Important data-safety rule

Do not create a second independent production PostgreSQL database for the replica. Two writable databases without deliberate replication/fencing create split-brain risk. The durable state belongs in the authoritative database/object store; backend containers are replaceable compute.

## Cost target

The deployment is designed so the standby compute can live on a free VM tier or a very small VPS. GitHub Container Registry can hold the container image, and the repository itself remains the source of truth for deployments.
