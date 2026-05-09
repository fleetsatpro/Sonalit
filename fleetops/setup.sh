#!/usr/bin/env bash
set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
GOLD='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "\n${GOLD}${BOLD}  ⚡ FleetOps Pro — Local Setup${NC}\n"

# Node version check
NODE_VER=$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1)
if [[ -z "$NODE_VER" || "$NODE_VER" -lt 20 ]]; then
  echo -e "${RED}✗ Node.js 20+ required. Found: $(node -v 2>/dev/null || echo 'none')${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Node.js $(node -v)${NC}"

# Backend deps
echo -e "\n${BOLD}Installing backend dependencies…${NC}"
cd backend
npm install
echo -e "${GREEN}✓ Backend dependencies installed${NC}"

# Copy env if missing
if [[ ! -f .env ]]; then
  cp .env.example .env
  echo -e "${GOLD}⚠  backend/.env created from example — edit DATABASE_URL and JWT_SECRET${NC}"
fi
cd ..

# Frontend deps
echo -e "\n${BOLD}Installing frontend dependencies…${NC}"
cd frontend
npm install
echo -e "${GREEN}✓ Frontend dependencies installed${NC}"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo -e "${GOLD}⚠  frontend/.env created from example${NC}"
fi
cd ..

echo -e "\n${BOLD}${GREEN}✓ Setup complete!${NC}\n"
echo -e "Next steps:"
echo -e "  1. Edit ${BOLD}backend/.env${NC} — set DATABASE_URL and JWT_SECRET"
echo -e "  2. ${BOLD}cd backend && npm run migrate${NC}   — create tables"
echo -e "  3. ${BOLD}npm run seed${NC}                   — load demo data"
echo -e "  4. ${BOLD}npm run dev${NC}                    — start API on :5000"
echo -e "  5. New terminal: ${BOLD}cd frontend && npm run dev${NC}  — start UI on :5173\n"
