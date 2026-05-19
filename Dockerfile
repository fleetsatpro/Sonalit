# ── Stage 1: dependencies ─────────────────────────────────────────────
FROM node:20-slim AS deps
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev

# ── Stage 2: runtime ──────────────────────────────────────────────────
FROM node:20-slim AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends dumb-init && \
    rm -rf /var/lib/apt/lists/* && \
    groupadd -r fleetops && useradd -r -g fleetops fleetops

COPY --from=deps /app/node_modules ./node_modules
COPY backend/ .

RUN mkdir -p logs && chown -R fleetops:fleetops /app

USER fleetops
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["npm", "start"]
