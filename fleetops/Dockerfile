# ── Stage 1: dependencies ─────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY backend/package*.json ./
RUN npm install --omit=dev && npm cache clean --force

# ── Stage 2: runtime ──────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache dumb-init && \
    addgroup -S fleetops && \
    adduser -S fleetops -G fleetops

COPY --from=deps /app/node_modules ./node_modules
COPY backend/ .

RUN mkdir -p logs && chown -R fleetops:fleetops /app

USER fleetops
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/app.js"]
