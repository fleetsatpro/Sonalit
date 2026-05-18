#!/bin/bash
set -e
echo "=== FleetOps Setup ==="
# Install PostgreSQL if missing
if ! command -v psql &>/dev/null; then
  apt-get update -qq && apt-get install -y -qq postgresql postgresql-contrib
fi
service postgresql start || true
sleep 2
CURRENT_USER=$(whoami)
psql -U postgres -c "CREATE ROLE $CURRENT_USER SUPERUSER LOGIN;" 2>/dev/null || true
psql -U postgres -c "CREATE DATABASE fleetops OWNER $CURRENT_USER;" 2>/dev/null || true
cat > /workspaces/Sonalit/backend/.env << ENV
DATABASE_URL=postgresql://${CURRENT_USER}@localhost/fleetops?host=/var/run/postgresql
JWT_SECRET=fleetops-dev-secret
DISABLE_REDIS=true
NODE_ENV=development
PORT=5000
FRONTEND_URL=http://localhost:5173
ENV
cd /workspaces/Sonalit/backend
node scripts/migrate.js && node scripts/migrate-extended.js && node scripts/seed.js
echo "✅ Setup complete!"
