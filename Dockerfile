FROM public.ecr.aws/docker/library/node:22-slim

# PDF/SVG rendering uses sharp/libvips; provide a real Fontconfig runtime so
# map labels and embedded text render consistently in production containers.
RUN apt-get update \
  && apt-get install -y --no-install-recommends fontconfig fonts-dejavu \
  && fc-cache -f \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Sonalit is a pnpm workspace. The root lockfile is the single authoritative
# production dependency graph; do not create a second npm lock contract.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/package.json

RUN npm install --global pnpm@11.28.4 --no-audit --fund=false \
  && pnpm install --filter fleetops-backend --prod --frozen-lockfile --ignore-scripts

COPY backend/ ./backend/
RUN mkdir -p backend/logs

# Railway carries the productionRiskIntelligencePatches preload in NODE_OPTIONS.
# That preload is intentionally relative to the backend package root. Keep the
# runtime CWD at /app/backend so Node resolves all package-local preloads before
# npm/pnpm starts the application.
WORKDIR /app/backend

EXPOSE 5000
CMD ["pnpm", "--filter", "fleetops-backend", "start"]
