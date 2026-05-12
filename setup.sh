#!/bin/bash
sudo service postgresql start && sleep 2
psql -U postgres -c "CREATE ROLE codespace SUPERUSER LOGIN;" 2>/dev/null || true
psql -U postgres -c "CREATE DATABASE fleetops OWNER codespace;" 2>/dev/null || true
cat > backend/.env << 'ENV'
DATABASE_URL=postgresql://codespace@localhost/fleetops?host=/var/run/postgresql
JWT_SECRET=fleetops-dev-secret
DISABLE_REDIS=true
NODE_ENV=development
PORT=5000
FRONTEND_URL=http://localhost:5173
ENV
cd backend && npm install && node scripts/migrate.js && node scripts/migrate-extended.js && node scripts/seed.js
cd ../frontend && npm install
echo "✅ Done! Run: cd backend && npm run dev"
