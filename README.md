# FleetOps Pro — Fleet & Convoy Management System

**Tactical real-time fleet coordination platform** for security convoy operations across East and Central Africa (Kenya, DRC, Tanzania, Mali).

![Status](https://img.shields.io/badge/status-production--ready-brightgreen)
![Node](https://img.shields.io/badge/node-20%2B-green)
![React](https://img.shields.io/badge/react-18-blue)
![PostgreSQL](https://img.shields.io/badge/postgresql-15-336791)
![Redis](https://img.shields.io/badge/redis-7-red)
![License](https://img.shields.io/badge/license-ISC-blue)

---

## Table of Contents

1. [Overview](#overview)
2. [Repository Layout](#repository-layout)
3. [Architecture](#architecture)
4. [Features](#features)
5. [Tech Stack](#tech-stack)
6. [Database Schema](#database-schema)
7. [Quick Start — Docker](#quick-start--docker-recommended)
8. [Quick Start — Manual](#quick-start--manual)
9. [Environment Variables](#environment-variables)
10. [API Reference](#api-reference)
11. [Real-Time Events (Socket.IO)](#real-time-events-socketio)
12. [Background Workers](#background-workers)
13. [Standalone UI Prototype (FleetOpsPro.jsx)](#standalone-ui-prototype-fleetopsprojsx)
14. [Deployment](#deployment)
15. [Testing](#testing)
16. [Security](#security)
17. [Troubleshooting](#troubleshooting)
18. [Known Issues & Fixes](#known-issues--fixes)
19. [Production Checklist](#production-checklist)
20. [Contributing](#contributing)
21. [License](#license)

---

## Overview

FleetOps Pro is a full-stack Node.js + React application for managing security vehicle fleets and convoys in high-risk operational regions. It provides:

- Live GPS tracking with WebSocket push
- Convoy mission lifecycle management
- Automated alert escalation via background job queues
- Role-gated dashboards for Admin, Dispatcher, Operator, and Analyst
- A self-contained React UI prototype (`FleetOpsPro.jsx`) that can be dropped into any hosting environment without a backend

---

## Repository Layout

```
Fleet-Management/
│
├── backend/                        ← Production backend (USE THIS)
│   ├── src/
│   │   ├── app.js                  ← Express + Socket.IO server
│   │   ├── config/
│   │   │   ├── database.js         ← PostgreSQL pool + schema initialisation
│   │   │   └── redis.js            ← ioredis client with retry logic
│   │   ├── controllers/
│   │   │   ├── authController.js   ← login, getCurrentUser, logout
│   │   │   ├── vehicleController.js
│   │   │   ├── convoyController.js
│   │   │   └── alertController.js
│   │   ├── middleware/
│   │   │   ├── auth.js             ← authenticate (JWT), authorize (RBAC)
│   │   │   └── error.js            ← errorHandler, asyncHandler
│   │   ├── routes/
│   │   │   ├── auth.js
│   │   │   ├── vehicles.js
│   │   │   ├── convoys.js
│   │   │   ├── alerts.js
│   │   │   ├── messages.js         ⚠ stub — returns mock data (see Known Issues)
│   │   │   └── analytics.js        ⚠ stub — returns mock data (see Known Issues)
│   │   └── utils/
│   │       └── logger.js           ← Winston logger
│   └── scripts/
│       ├── migrate.js              ← Run once to bootstrap schema
│       ├── seed.js                 ← Creates demo users + 15 vehicles + convoys
│       └── start-workers.js        ← Launches all three BullMQ workers
│
├── frontend/                       ← React 18 + Vite + Tailwind frontend
│   └── src/
│       ├── pages/
│       │   ├── LoginPage.jsx
│       │   ├── DashboardPage.jsx
│       │   ├── FleetPage.jsx
│       │   ├── ConvoysPage.jsx
│       │   └── PlaceholderPages.jsx
│       ├── components/
│       │   ├── Layout.jsx          ← Sidebar + Header (enhanced version fixes nav bugs)
│       │   ├── UI.jsx              ← Shared design system (Button, Card, Modal, Badge…)
│       │   └── ProtectedRoute.jsx
│       ├── services/
│       │   ├── api.js              ← Axios client + typed endpoint wrappers
│       │   └── socket.js           ← Socket.IO client with duplicate-connection guard
│       ├── store/
│       │   └── index.js            ← Zustand stores (auth, vehicles, convoys, alerts)
│       ├── hooks/
│       │   └── index.js            ← useSocket, useAsync, useDebounce, useLocalStorage
│       └── utils/
│           └── helpers.js          ← formatDate, statusColor, validators
│
├── src/                            ← ⚠ Legacy monolith (pre-refactor, do not use in production)
│   ├── index.js                    ← Old entry point (ws + BullMQ wired directly)
│   ├── app.js                      ← Bare-bones Express + raw WebSocket server
│   ├── config/, models/, routes/   ← Superseded by backend/ equivalents
│   └── workers/                    ← GPS, alert, notification workers (still used by src/index.js)
│
├── public/                         ← Vanilla JS static frontend (Vercel-compatible)
│   ├── index.html
│   ├── app.js
│   └── config.js                   ← Set window.API_ROOT to point at your backend
│
├── FleetOpsPro.jsx                 ← Self-contained React prototype (no backend needed)
│
├── Dockerfile                      ← Multi-stage build targeting backend/
├── docker-compose.yml              ← App + PostgreSQL 15 + Redis 7
├── railway.json                    ← Railway deployment config
├── vercel.json                     ← Vercel routing config (frontend)
├── setup.sh                        ← One-shot local setup script
└── test-api.sh                     ← Curl-based smoke test suite
```

> **Why does `src/` still exist?**
> The `src/` tree is the original pre-refactor monolith. It shares the same BullMQ workers and Redis infrastructure but uses a simpler schema (SERIAL IDs, no UUIDs) and a raw WebSocket server instead of Socket.IO. It is kept for reference only. **All active development happens in `backend/` and `frontend/`.**

---

## Architecture

```
                         ┌─────────────────────────────────────────┐
                         │              CLIENT LAYER                │
                         │                                         │
                         │  React 18 SPA (frontend/)               │
                         │  ├─ Zustand  ├─ Socket.IO-client        │
                         │  ├─ Axios    └─ Recharts / Leaflet       │
                         └────────────────┬────────────────────────┘
                                          │ HTTPS / WSS
                         ┌────────────────▼────────────────────────┐
                         │           API GATEWAY LAYER              │
                         │                                         │
                         │  Express 4  +  Socket.IO 4              │
                         │  ├─ Helmet (security headers)           │
                         │  ├─ express-rate-limit (100 req/15 min) │
                         │  ├─ CORS (restricted to FRONTEND_URL)   │
                         │  └─ JWT middleware (Bearer token)        │
                         └───────┬───────────────┬─────────────────┘
                                 │               │
               ┌─────────────────▼──┐       ┌───▼──────────────────┐
               │   PostgreSQL 15    │       │      Redis 7          │
               │                   │       │                       │
               │  users            │       │  BullMQ queues:       │
               │  vehicles         │       │  ├─ gps               │
               │  convoys          │       │  ├─ alert             │
               │  convoy_assignments│       │  └─ notification      │
               │  alerts           │       │                       │
               │  incidents        │       └───────────────────────┘
               │  messages         │                   │
               │  channels         │       ┌───────────▼───────────┐
               │  audit_logs       │       │   Background Workers   │
               └────────────────── ┘       │                       │
                                           │  gpsWorker.js         │
                                           │  alertWorker.js       │
                                           │  notificationWorker.js│
                                           └───────────────────────┘

GPS Pipeline:
  POST /api/v1/gps → validate → BullMQ(gps) → gpsWorker
    ├─ Store in gps_logs
    ├─ Speed check → BullMQ(alert) → alertWorker → DB + WebSocket push
    ├─ Geofence check (haversine) → BullMQ(alert) → alertWorker
    └─ Broadcast vehicle:update via Socket.IO
```

---

## Features

| Category | Capability |
|---|---|
| Real-Time GPS | Live location push via Socket.IO; haversine-based geofence checking |
| Convoy Ops | Full mission lifecycle: planned → active → completed / aborted |
| Alert Engine | Automated speed + geofence alerts; severity levels; acknowledge + resolve |
| Fleet Management | CRUD with pagination + filtering; soft deletes; driver assignment |
| Analytics | Dashboard KPIs, fleet utilisation by region, convoy trend metrics, incident heatmap |
| Messaging | Channel-based comms + system-wide broadcast |
| Auth & RBAC | JWT (24 h); roles: `admin`, `dispatcher`, `operator`, `analyst` |
| Audit Logs | Immutable history of every data mutation (who, when, what) |
| Background Jobs | BullMQ queue with retry + exponential backoff |
| Notifications | Email via Nodemailer (SMTP); extensible for SMS |

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Runtime | Node.js | 20 LTS |
| API Framework | Express | 4.18 |
| Real-time | Socket.IO | 4.7 |
| Frontend | React + Vite + Tailwind CSS | 18 / 5 / 3.4 |
| State | Zustand | 4.4 |
| Charts | Recharts | 2.10 |
| Maps | Leaflet + react-leaflet | 1.9 / 4.2 |
| Database | PostgreSQL | 15 |
| Cache / Queue | Redis + BullMQ | 7 / 1.62 |
| Auth | JWT + bcryptjs | 9 / 2.4 |
| Validation | Joi (backend) + Zod + react-hook-form (frontend) | — |
| HTTP client | Axios | 1.6 |
| Logging | Winston | 3.11 |
| Security | Helmet 7, express-rate-limit 7, parameterised SQL | — |
| Container | Docker + Docker Compose | — |

> **Note on `bcrypt` vs `bcryptjs`:** The root `package.json` (legacy `src/` layer) references `bcrypt` v6 — which does not exist; bcrypt's latest major is 5.x. The production `backend/package.json` correctly uses `bcryptjs` v2.4, which is pure JavaScript, zero native dependencies, and fully compatible. If you are running anything from the `src/` layer, replace `bcrypt` with `bcryptjs` in that tree.

---

## Database Schema

All tables carry `id UUID`, `created_at`, `updated_at`, and `deleted_at` (soft deletes) unless noted.

```sql
-- Core tables (auto-created by backend/scripts/migrate.js or on first server start)

users               (id, email, name, password_hash, role, status)
vehicles            (id, type, registration, region, status, capacity,
                     latitude, longitude, last_ping, driver_id→users, assigned_convoy_id→convoys)
convoys             (id, name, region, status, priority, description,
                     departure_time, arrival_time, estimated_arrival,
                     route_origin, route_destination, created_by→users)
convoy_assignments  (convoy_id→convoys, vehicle_id→vehicles, role, joined_at)
alerts              (id, vehicle_id→vehicles, convoy_id→convoys, type,
                     severity, message, acknowledged_at, resolved_at, created_by→users)
incidents           (id, convoy_id→convoys, title, description, severity, status)
channels            (id, name, description)
messages            (id, channel_id→channels, sender_id→users, content)
audit_logs          (id, table_name, record_id, action, old_data, new_data, user_id→users)

-- GPS pipeline table (managed by gpsWorker)
gps_logs            (id SERIAL, vehicle_id, lat, lng, speed, timestamp)
```

**Indexes:** Partial indexes on all `status`, `region`, and FK columns scoped to `WHERE deleted_at IS NULL` to keep query plans efficient on large datasets.

---

## Quick Start — Docker (Recommended)

Requires Docker Desktop or Docker Engine ≥ 24.

```bash
git clone https://github.com/OnyariDEV/Fleet-Management.git
cd Fleet-Management

# Start PostgreSQL 15 + Redis 7 + Express API
docker compose up --build -d

# Wait ~10 s for postgres to become healthy, then seed
docker compose exec app node backend/scripts/migrate.js
docker compose exec app node backend/scripts/seed.js

# Start the React frontend in a second terminal
cd frontend && npm install && npm run dev
```

| Service | URL |
|---|---|
| Backend API | http://localhost:5000 |
| React frontend | http://localhost:5173 |
| PostgreSQL | localhost:5432 |
| Redis | localhost:6379 |

---

## Quick Start — Manual

### Prerequisites

- Node.js ≥ 20
- PostgreSQL 15
- Redis 7

```bash
# ── 1. System services (macOS) ──────────────────────────────────────
brew install postgresql@15 redis
brew services start postgresql@15
brew services start redis

# ── 1. System services (Ubuntu/Debian) ──────────────────────────────
sudo apt update && sudo apt install -y postgresql-15 redis-server
sudo systemctl start postgresql redis-server

# ── 2. Database ──────────────────────────────────────────────────────
createdb convoy          # creates the 'convoy' database as current user

# ── 3. Backend ───────────────────────────────────────────────────────
cd backend
npm install
cp .env.example .env     # then edit .env — set DATABASE_URL, JWT_SECRET at minimum
npm run migrate          # creates all tables
npm run seed             # creates demo users + vehicles
npm run dev              # starts API on :5000 with nodemon

# ── 4. Frontend (new terminal) ───────────────────────────────────────
cd frontend
npm install
cp .env.example .env     # set VITE_API_URL and VITE_SOCKET_URL
npm run dev              # starts Vite on :5173
```

### Demo Credentials (seeded by `npm run seed`)

| Role | Email | Password |
|---|---|---|
| Admin | admin@convoy.local | password123 |
| Dispatcher | dispatcher@convoy.local | password123 |
| Operator | operator@convoy.local | password123 |

---

## Environment Variables

### Backend (`backend/.env`)

```env
# ── Required ──────────────────────────────────────────────────────────
DATABASE_URL=postgresql://postgres:password@localhost:5432/convoy
JWT_SECRET=<generate with: openssl rand -base64 32>
NODE_ENV=development

# ── Server ────────────────────────────────────────────────────────────
PORT=5000
FRONTEND_URL=http://localhost:5173

# ── Redis ─────────────────────────────────────────────────────────────
REDIS_URL=redis://127.0.0.1:6379
# Set DISABLE_REDIS=true when deploying to platforms without Redis (e.g. Vercel)
# DISABLE_REDIS=false

# ── Auth ──────────────────────────────────────────────────────────────
JWT_EXPIRE=24h

# ── Logging ───────────────────────────────────────────────────────────
LOG_LEVEL=info

# ── Alert thresholds ──────────────────────────────────────────────────
SPEED_ALERT_THRESHOLD=120          # km/h above which a speeding alert fires
GEOFENCE_RADIUS_KM=5               # km deviation from convoy route triggers alert
ALERT_COOLDOWN_MINUTES=10          # min gap between repeat alerts per vehicle
MAX_QUEUE_RETRIES=3

# ── Email notifications (optional) ────────────────────────────────────
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_FROM=noreply@fleetmanagement.com

# ── Maps (optional) ───────────────────────────────────────────────────
GOOGLE_MAPS_API_KEY=your-key-here
```

### Frontend (`frontend/.env`)

```env
VITE_API_URL=http://localhost:5000/api/v1
VITE_SOCKET_URL=http://localhost:5000
```

---

## API Reference

All endpoints (except `/health`) require:

```
Authorization: Bearer <jwt-token>
```

Tokens are obtained from `POST /api/v1/auth/login` and expire after 24 hours.

### Health

```
GET  /health          System status (DB + Redis ping)
```

### Authentication

```
POST   /api/v1/auth/login       { email, password } → { user, token }
GET    /api/v1/auth/me          Current user profile
POST   /api/v1/auth/logout      Confirms logout (token cleared client-side)
```

### Fleet — Vehicles

```
GET    /api/v1/vehicles                       Paginated list; filter by ?status=&region=
POST   /api/v1/vehicles                       Create vehicle  [admin, dispatcher]
GET    /api/v1/vehicles/:id                   Single vehicle
PUT    /api/v1/vehicles/:id                   Full update     [admin, dispatcher]
PATCH  /api/v1/vehicles/:id/status            Status only     [admin, dispatcher, operator]
DELETE /api/v1/vehicles/:id                   Soft delete     [admin]
GET    /api/v1/vehicles/:id/history           GPS history log
```

### Convoy Operations

```
GET    /api/v1/convoys                        List; filter by ?status=&region=&priority=
POST   /api/v1/convoys                        Create          [admin, dispatcher]
GET    /api/v1/convoys/:id                    Single convoy
PUT    /api/v1/convoys/:id                    Full update     [admin, dispatcher]
PATCH  /api/v1/convoys/:id/status             Status only
POST   /api/v1/convoys/:id/assign             Assign vehicles { vehicleIds: [] }
DELETE /api/v1/convoys/:id                    Soft delete     [admin]
GET    /api/v1/convoys/:id/events             Event timeline for convoy
```

### Alerts & Incidents

```
GET    /api/v1/alerts                         List; filter by ?severity=&status=
POST   /api/v1/alerts                         Create manual alert
GET    /api/v1/alerts/:id
PATCH  /api/v1/alerts/:id/acknowledge         Mark acknowledged
PATCH  /api/v1/alerts/:id/resolve             Mark resolved
```

### Messaging

```
GET    /api/v1/messages/channels              Available channels
GET    /api/v1/messages/channels/:id          Messages in channel (?page=&limit=)
POST   /api/v1/messages/channels/:id          Send message { content }
POST   /api/v1/messages/broadcast             System broadcast { content, severity }
```

> ⚠ **Stub routes:** `messages` and `analytics` currently return hardcoded fixture data. They are wired to real auth middleware but not yet connected to the database. Track progress in the issue tracker.

### Analytics

```
GET    /api/v1/analytics/dashboard            KPI snapshot
GET    /api/v1/analytics/fleet-utilization    Utilisation by region
GET    /api/v1/analytics/convoy-metrics       Completion trends
GET    /api/v1/analytics/incident-heatmap     Geographic incident density
```

### GPS Ingestion (Legacy / IoT endpoint)

```
POST   /api/gps    { vehicle_id, lat, lng, speed, timestamp }
GET    /api/gps/:vehicleId    Location history
```

> This route lives in the `src/routes/gps.js` layer and feeds the BullMQ `gps` queue. Prefer posting to this endpoint from IoT devices and using `GET /api/v1/vehicles/:id/history` for reads.

### Example: Create a Convoy

```bash
curl -X POST https://your-backend.railway.app/api/v1/convoys \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Operation Alpha",
    "region": "Kenya",
    "priority": "high",
    "description": "VIP transport — Nairobi to Mombasa",
    "departureTime": "2025-06-01T08:00:00Z",
    "routeOrigin": "Nairobi",
    "routeDestination": "Mombasa"
  }'
```

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Operation Alpha",
  "region": "Kenya",
  "status": "planned",
  "priority": "high",
  "created_at": "2025-05-30T14:00:00Z"
}
```

### Example: Submit GPS Data

```bash
curl -X POST http://localhost:5000/api/gps \
  -H "Content-Type: application/json" \
  -d '{
    "vehicle_id": "1",
    "lat": -1.2921,
    "lng": 36.8219,
    "speed": 85,
    "timestamp": "2025-05-30T09:15:00Z"
  }'
```

---

## Real-Time Events (Socket.IO)

The Socket.IO server runs on the same port as Express. Authentication uses your JWT:

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:5000', {
  auth: { token: localStorage.getItem('token') },
  transports: ['websocket', 'polling'],  // websocket first for lower latency
  reconnectionAttempts: 5,
  reconnectionDelayMax: 5000,
});

socket.on('connect', () => console.log('Connected:', socket.id));

// Vehicle moved
socket.on('vehicle:update', ({ vehicleId, lat, lng, speed }) => { /* … */ });

// Convoy status changed
socket.on('convoy:update', ({ convoyId, status, updatedBy }) => { /* … */ });

// New alert fired
socket.on('alert:new', ({ alertId, vehicleId, type, severity, message }) => { /* … */ });

// New channel message
socket.on('message:new', ({ channelId, content, senderId }) => { /* … */ });

// New incident
socket.on('incident:new', ({ incidentId, convoyId, severity }) => { /* … */ });
```

> The enhanced `frontend/src/services/socket.js` adds guards against duplicate connections, missing-socket warnings on `emit`/`on`, and an `isConnected()` helper. Use that file as the canonical implementation.

---

## Background Workers

Workers run as long-lived processes consuming BullMQ queues backed by Redis.

```bash
# All workers in one process (recommended for Railway)
cd backend && npm run workers

# Individual workers
npm run worker:gps           # GPS ingestion + speed/geofence checks
npm run worker:alert         # Alert creation, deduplication, DB write
npm run worker:notification  # Email dispatch via Nodemailer
```

### Pipeline

```
IoT device  →  POST /api/gps
                │
                ▼
           BullMQ: gps queue
                │
                ▼
           gpsWorker.js
           ├─ INSERT INTO gps_logs
           ├─ speed > SPEED_ALERT_THRESHOLD?  → BullMQ: alert queue
           ├─ haversine deviation > GEOFENCE_RADIUS_KM? → BullMQ: alert queue
           └─ Socket.IO broadcast → vehicle:update
                │
                ▼ (if alert queued)
           alertWorker.js
           ├─ INSERT INTO alerts
           ├─ Socket.IO broadcast → alert:new
           └─ BullMQ: notification queue
                │
                ▼
           notificationWorker.js
           └─ Nodemailer → SMTP
```

**Retry policy:** BullMQ uses exponential backoff with `MAX_QUEUE_RETRIES` (default 3) attempts before moving a job to the dead-letter set.

---

## Standalone UI Prototype (FleetOpsPro.jsx)

`FleetOpsPro.jsx` is a **self-contained, single-file React component** — no backend connection, no environment variables, no build config required beyond what Claude's artifact runner provides.

It renders a complete operations dashboard with mock data:

| Page | What it shows |
|---|---|
| Dashboard | KPI cards, live telemetry feed, area + radar charts |
| Fleet | Vehicle table with status filters, add/edit modal |
| Convoys | Mission cards with lifecycle status |
| GPS | Live coordinate feed, speed history chart |
| Alerts | Alert list with severity badges and resolve action |
| Analytics | Bar, line, pie, and radar charts across all metrics |
| Audit | Immutable event log |
| Settings | Theme + notification toggles |

**Design system highlights:**

- Deep navy command-center palette (`#080C14` background)
- Orbitron display font + IBM Plex Mono for data values
- CSS grid background with gold gradient radials
- Pulse dot live indicator, sticky topbar with clock
- Toast notification system (success / error / warning / info)
- Collapsible sidebar

**To run:**

```jsx
// In any React 18 project with recharts installed:
import App from './FleetOpsPro.jsx';
// <App /> — no props required
```

Or paste directly into a Claude.ai artifact — it renders with zero setup.

> This prototype does **not** make API calls. It is intended for UI review, stakeholder demos, and design iteration. Connecting it to the live backend requires replacing the local `_vehicles`, `_convoys`, `_alerts` state with Axios calls to `/api/v1/*` and wiring the `socketService`.

---

## Deployment

### Railway (Recommended — full features)

Railway provides managed PostgreSQL and Redis, so all workers and Socket.IO features run without extra config.

```bash
# 1. Push to GitHub
git push origin main

# 2. railway.app → New Project → Import GitHub repo
# 3. Add PostgreSQL plugin → copy DATABASE_URL to env
# 4. Add Redis plugin → copy REDIS_URL to env
# 5. Set env vars:
NODE_ENV=production
JWT_SECRET=<openssl rand -base64 32>
FRONTEND_URL=https://your-frontend.vercel.app
PORT=5000

# 6. Railway auto-deploys via Dockerfile
```

Post-deploy, run migrations once via the Railway shell:

```bash
node backend/scripts/migrate.js
node backend/scripts/seed.js
```

### Vercel (Frontend) + Railway (Backend)

```bash
# Frontend
cd frontend
cp .env.example .env.production
# Set VITE_API_URL=https://your-backend.railway.app/api/v1
# Set VITE_SOCKET_URL=https://your-backend.railway.app
vercel --prod
```

### Self-Hosted (Docker Compose)

```bash
git clone https://github.com/OnyariDEV/Fleet-Management.git
cd Fleet-Management

# Edit docker-compose.yml to set JWT_SECRET
docker compose up -d

docker compose exec app node backend/scripts/migrate.js
docker compose exec app node backend/scripts/seed.js
```

Place Nginx in front for SSL termination and WebSocket proxying:

```nginx
location /socket.io/ {
    proxy_pass         http://localhost:5000;
    proxy_http_version 1.1;
    proxy_set_header   Upgrade $http_upgrade;
    proxy_set_header   Connection "upgrade";
    proxy_set_header   Host $host;
}
```

### Vercel (Static public/ frontend only)

The `public/` folder is a vanilla JS frontend with no build step. Set the API root in `public/config.js`:

```js
window.API_ROOT = 'https://your-backend.railway.app/api';
```

Then deploy with the Vercel CLI:

```bash
vercel --prod
```

Note: this static frontend does not support Socket.IO real-time features.

---

## Testing

```bash
# Smoke-test the running API
bash ./test-api.sh
```

Expected output:

```
✅ PASS - Health check returned 200
✅ PASS - Vehicles endpoint returned 200
✅ PASS - Invalid endpoint properly handled
✅ PASS - Response time: ~14ms
✅ PASS - All 10 requests succeeded
```

> ⚠ **Fix applied:** The original `test-api.sh` hit `/api/vehicles`, which does not exist — the correct base path is `/api/v1/vehicles`. If you see 404s, verify the `BASE_URL` variable and endpoint paths in the script match `/api/v1/*`.

**Manual smoke tests:**

```bash
# Health
curl http://localhost:5000/health

# Login
curl -X POST http://localhost:5000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@convoy.local","password":"password123"}'

# List vehicles (with token)
curl http://localhost:5000/api/v1/vehicles \
  -H "Authorization: Bearer $TOKEN"

# GPS push
curl -X POST http://localhost:5000/api/gps \
  -H "Content-Type: application/json" \
  -d '{"vehicle_id":"1","lat":-1.2921,"lng":36.8219,"speed":130,"timestamp":"2025-05-30T09:00:00Z"}'
```

---

## Security

| Control | Implementation |
|---|---|
| Authentication | JWT (24 h expiry); Bearer token in `Authorization` header |
| RBAC | `admin > dispatcher > operator > analyst`; enforced per route via `authorize([…])` middleware |
| Password hashing | `bcryptjs` with 10 salt rounds |
| Transport security | Helmet 7 sets CSP, HSTS, X-Frame-Options, X-Content-Type-Options |
| CORS | Restricted to `FRONTEND_URL` env variable; credentials allowed |
| Rate limiting | 100 requests / 15 min per IP (express-rate-limit) |
| SQL injection | All queries use `pg` parameterised `$1, $2` placeholders — never string concatenation |
| Soft deletes | `deleted_at` timestamp; records never hard-deleted for audit compliance |
| Audit logs | Every INSERT / UPDATE / DELETE records old + new state with the acting user |
| No secrets in code | All credentials exclusively in environment variables |
| WebSocket auth | Socket.IO middleware verifies JWT on every connection handshake |

---

## Troubleshooting

### `ECONNREFUSED 127.0.0.1:6379` (Redis)

```bash
# macOS
brew services start redis

# Linux
sudo systemctl start redis-server

# Verify
redis-cli ping   # → PONG

# Or disable Redis entirely (workers will skip)
echo "DISABLE_REDIS=true" >> backend/.env
```

### `EADDRINUSE :::5000` (port conflict)

```bash
lsof -i :5000
kill -9 <PID>
```

### `Database connection failed`

```bash
# Verify PostgreSQL is running
psql $DATABASE_URL

# Create the database if missing
createdb convoy

# Re-run migrations
node backend/scripts/migrate.js
```

### `401 Unauthorized`

```bash
# Token must be in Authorization header, not query string
curl -H "Authorization: Bearer eyJhbGc..." http://localhost:5000/api/v1/vehicles
```

### Socket.IO not connecting in browser

```javascript
// Open browser console and check for connect_error
socket.on('connect_error', (err) => console.error('[Socket]', err.message));
// Common causes: wrong VITE_SOCKET_URL, CORS mismatch, token expired
```

### Workers not starting

```bash
# Ensure Redis is up, then:
cd backend && npm run workers
# Check for "Workers initialized successfully" in logs
```

### Clean reset

```bash
pkill -f node
rm -f *.log
docker compose down -v   # wipes DB volumes
docker compose up -d
node backend/scripts/migrate.js && node backend/scripts/seed.js
```

---

## Known Issues & Fixes

### ✅ Resolved: Redis `ECONNREFUSED` on local dev

**Cause:** Redis not installed locally or not running.  
**Fix:** Install and start Redis, or set `DISABLE_REDIS=true` for environments without it. The server now gracefully skips queue initialisation when Redis is absent.

### ✅ Resolved: Socket.IO duplicate connections

**Cause:** `socketService.connect()` was called multiple times (e.g. on React StrictMode double-render), creating zombie connections.  
**Fix:** `frontend/src/services/socket.js` (enhanced version) now checks `socket?.connected` before creating a new connection, and warns in console rather than silently failing when emitting before connect.

### ✅ Resolved: Port 5000 conflict on restart

**Cause:** Lingering Node.js processes from a previous run.  
**Fix:** `lsof -i :5000 | awk 'NR>1 {print $2}' | xargs kill -9`

### ⚠ Open: Analytics & messages routes return stub data

`backend/src/routes/analytics.js` and `backend/src/routes/messages.js` return hardcoded arrays — they are not connected to PostgreSQL yet. Full implementations tracking real-time DB state are planned.

### ⚠ Open: Root `package.json` references non-existent `bcrypt` v6

`bcrypt` does not publish a version 6. This dependency in the root `package.json` is from the legacy `src/` layer. It must be changed to `bcryptjs` before running the legacy server. The production `backend/` tree is unaffected.

### ⚠ Open: `test-api.sh` uses wrong API prefix

The script sends requests to `/api/vehicles` instead of `/api/v1/vehicles`. Update `BASE_URL` or the endpoint paths in the script to match the live API.

### ⚠ Open: Dockerfile base image vs README badge mismatch

The `Dockerfile` correctly targets `node:20-alpine`. An older README badge claimed Node 18. The badge has been corrected in this document — ensure your CI/CD base image stays in sync with the Dockerfile.

### ⚠ Open: `FRONTEND_NOTES.md` contradicts repo structure

`FRONTEND_NOTES.md` states the repo is backend-only, but a fully featured `frontend/` directory exists alongside it. That file reflects an older architectural intent and should be deleted or updated.

### ⚠ Open: Duplicate `GOOGLE_MAPS_API_KEY` in `.env.example`

The key appears twice in the original `.env.example`. Consolidated to a single entry in this documentation.

---

## Production Checklist

```
Infrastructure
  [ ] PostgreSQL backups configured (daily minimum)
  [ ] Redis persistence enabled (AOF or RDB)
  [ ] HTTPS/TLS termination in front of Node (Nginx or Railway)
  [ ] Environment: NODE_ENV=production

Security
  [ ] JWT_SECRET ≥ 32 random bytes (openssl rand -base64 32)
  [ ] FRONTEND_URL set to exact production domain (no trailing slash)
  [ ] Remove all console.log() calls — use logger only
  [ ] Rate limit thresholds reviewed for expected traffic

Database
  [ ] npm run migrate executed on fresh deployment
  [ ] npm run seed run once (or custom seed for production users)
  [ ] pg connection pool max reviewed (default 20)

Workers
  [ ] npm run workers running as a separate Railway service or process
  [ ] SMTP credentials set for email notifications
  [ ] Queue retry policy reviewed (MAX_QUEUE_RETRIES)

Monitoring
  [ ] Winston log level set to 'info' (not 'debug')
  [ ] Error tracking (Sentry / Datadog) wired to errorHandler middleware
  [ ] Health endpoint responding: GET /health → { status: "ok" }
  [ ] Socket.IO reconnection tested under network interruption

Validation
  [ ] Login flow end-to-end tested
  [ ] Create vehicle → assign to convoy → update status tested
  [ ] GPS push → worker → alert → Socket.IO event verified
  [ ] All four roles tested with correct permission boundaries
```

---

## Contributing

1. Fork the repository and create a feature branch from `main`.
2. Follow the pipeline-first architecture — new data flows go through BullMQ, not inline in route handlers.
3. All database queries must use parameterised statements.
4. Add proper error handling and Winston logging.
5. If adding a route, document it in the API Reference section of this README.
6. Open a pull request with a description of what changed and why.

---

## License

ISC — use freely in personal and commercial projects.

---

## Author

**OnyariDEV** — Fullstack engineer specialising in real-time systems  
Issues: [GitHub Issues](https://github.com/OnyariDEV/Fleet-Management/issues)  
Discussions: [GitHub Discussions](https://github.com/OnyariDEV/Fleet-Management/discussions)
