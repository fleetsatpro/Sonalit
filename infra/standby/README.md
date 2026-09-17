# Sonalit Redundant Backend Runtime

Sonalit uses a provider-independent active/standby backend topology so a Railway outage or billing pause does not require rewriting or rebuilding the application.

## Topology

```text
                         SONALIT SOURCE
                              |
                        Git commit / image
                              |
                    GitHub Container Registry
                              |
              +---------------+---------------+
              |                               |
        PRIMARY RUNTIME                  STANDBY RUNTIME
           Railway                       Docker host / VPS
              |                               |
              +---------------+---------------+
                              |
                    Authoritative services
                    PostgreSQL / Redis / R2
```

Railway remains the normal primary runtime. The standby is a replaceable Docker compute node. Both use the same authoritative PostgreSQL/Redis services; there is intentionally no second writable production database.

## Runtime fencing

Only one production process is allowed to own Sonalit's active runtime fence.

- `SONALIT_STANDBY=true` keeps the replica fenced and disables cron side effects plus in-process workers.
- Active production startup claims a lease in the authoritative `sonalit_runtime_fence` table before `app.js` is loaded.
- The lease is serialized with a PostgreSQL advisory lock and refreshed by heartbeat.
- A second active runtime refuses to start while the existing lease is fresh.
- A controlled takeover (`SONALIT_FENCE_TAKEOVER=true`) replaces the recorded owner; the displaced runtime detects loss of ownership and terminates on its next heartbeat.
- The application fence does not replace operational fencing: public traffic must still be removed from the primary before promotion.

The fence table is bootstrapped automatically by the runtime; no manual schema migration is required for this control plane.

## Standby host

A small Ubuntu/Debian VM with Docker and Docker Compose is sufficient. The standby container binds to `127.0.0.1:5000` only; place Caddy, Nginx, a Cloudflare Tunnel, or another authenticated reverse proxy in front of it when the host is promoted.

### First-time setup

1. Run `bash infra/standby/setup-host.sh` as root on the VM, or install Docker/Compose manually.
2. Create `/opt/sonalit-standby`.
3. Copy `infra/standby/docker-compose.yml`, `infra/standby/docker-compose.active.yml`, `infra/standby/promote.sh`, and `infra/standby/demote.sh` there.
4. Copy `infra/standby/.env.example` to `.env` and fill in the same authoritative production `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `CORS_ORIGINS`, and required integration secrets used by the primary.
5. Keep `SONALIT_STANDBY=true` and `ENABLE_INPROCESS_WORKERS=false` in the base compose service.
6. Authenticate Docker to GHCR, then start the replica:

```bash
cd /opt/sonalit-standby
docker compose pull
docker compose up -d
docker compose ps
curl --fail http://127.0.0.1:5000/health
```

## CI/CD

`.github/workflows/standby-backend.yml` now runs on standby-related pull requests and on `main`.

The workflow:

1. Validates the runtime-fence JavaScript.
2. Runs `bash -n` against promotion/demotion/host setup scripts.
3. Validates the merged Docker Compose configuration.
4. Builds `Dockerfile.standby`.
5. On `main`, publishes both the immutable Git-SHA image tag and the moving `standby` tag to GHCR.
6. If the standby-host secrets are configured, SSH-deploys the exact Git-SHA image and verifies `/health`.

Configure these GitHub Actions secrets for automatic standby deployment:

- `STANDBY_SSH_HOST`
- `STANDBY_SSH_USER`
- `STANDBY_SSH_KEY`
- `STANDBY_SSH_PORT` (optional; defaults to `22`)
- `STANDBY_GHCR_USER`
- `STANDBY_GHCR_TOKEN`

The deployment step remains optional: image build/validation still runs when those secrets are absent.

## Promotion

Promotion is deliberately explicit. Do not promote merely because the primary looks slow or because a single dependency is unhealthy.

First verify the Railway primary is fenced/offline and determine the exact image you intend to promote:

```bash
cd /opt/sonalit-standby
export SONALIT_IMAGE=ghcr.io/fleetsatpro/sonalit-backend:<git-sha>
export SONALIT_EXPECTED_REVISION=<git-sha>
export CONFIRM_SONALIT_FAILOVER=YES
bash ./promote.sh
```

The promotion script:

- verifies the existing standby is healthy;
- pulls the exact image and resolves its digest;
- optionally verifies the image OCI revision label matches `SONALIT_EXPECTED_REVISION`;
- runs migrations while the service remains fenced as standby;
- enables the active role with an explicit database-fence takeover;
- waits for `/health` before declaring local promotion successful.

Only after that local health check passes should the public DNS/reverse-proxy origin be switched to the standby host.

## Demotion / recovery

After the Railway primary has been repaired and verified independently, restore public routing to Railway first. Then return the standby host to its safe replica state:

```bash
cd /opt/sonalit-standby
export CONFIRM_SONALIT_DEMOTION=YES
bash ./demote.sh
```

The demotion script stops the active override, restarts the base fenced compose service, and verifies `/health`.

## Data safety

Do not create a second independent production PostgreSQL database for the replica. Two writable databases without deliberate replication/fencing create split-brain and data-loss risk.

The database and object store are the durable system of record; compute containers are replaceable. Backups and restore drills must be validated independently before any database migration or provider move.

## Cost target

The standby compute can live on a free VM tier or a small VPS while the primary remains Railway. GHCR is used as the portable image registry, so the same application image can be redeployed to another Docker-capable host without changing the application runtime code.
