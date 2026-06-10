#!/bin/sh
set -e
pnpm --filter @sonalit/web... build
(cd apps/guardian-convoy && npm ci && npm run build)
cp apps/guardian-convoy/dist/index.html apps/web/dist/convoy.html
mkdir -p apps/web/dist/convoy-assets
cp -r apps/guardian-convoy/dist/assets apps/web/dist/convoy-assets/assets
