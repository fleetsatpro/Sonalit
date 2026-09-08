#!/bin/sh
set -e
# Vercel may install production-only dependencies when NODE_ENV is inherited.
# The workspace build requires TypeScript/tsx tooling from devDependencies.
pnpm install --frozen-lockfile --prod=false
pnpm --filter @sonalit/web... build
find apps/web/dist -name '*.map' -delete
(cd apps/guardian-convoy && npm ci && npm run build)
cp apps/guardian-convoy/dist/index.html apps/web/dist/convoy.html
mkdir -p apps/web/dist/convoy-assets
cp -r apps/guardian-convoy/dist/assets apps/web/dist/convoy-assets/assets
