---
name: sonalit-workflow
description: How to approach any Sonalit task — domain identification, skill loading, implementation, review, and verification workflow.
triggers:
  - sonalit
  - workflow
  - how to
  - implement
  - build
  - modify
  - change
  - add feature
  - fix bug
related_skills:
  - sonalit-architecture
  - multi-tenancy
  - auth-security
  - testing
---

# Sonalit Development Workflow

## Purpose

This skill defines the standard workflow for any Sonalit development task. It prevents premature implementation by requiring domain identification, skill loading, and impact analysis before any code changes.

## When to Activate

Load this skill at the start of any Sonalit development task — feature implementation, bug fix, refactor, or investigation.

## The Workflow

### 1. Understand the Request

Read the full request. Identify what the user actually wants changed — not what you assume.

### 2. Identify Affected Domains

Map the request to one or more Sonalit domains:

| If the request involves... | Load skill... |
|---|---|
| Database tables, org-scoped queries, RLS | `multi-tenancy` (MANDATORY) |
| Authentication, authorization, tokens, roles, devices | `auth-security` (MANDATORY) |
| NATS, Centrifugo, BullMQ, GPS streaming, live updates, workers | `realtime-events` |
| Container tracking, bookings, e-locks, yard/port ops | `cds-container-delivery` |
| Convoys, CFO, trucks, seals, daily reports | `convoy-system` |
| Guardian devices, panic, DMS, Knox, commands | `guardian-system` |
| Cargo owner portal, custody chain, POD | `portal-system` |
| Geofences, route risk, OSINT, risk zones | `geo-risk-intel` |
| React components, routing, stores, design tokens | `frontend-patterns` |
| Visual quality, colors, spacing, typography | `frontend-design` |
| Animation, transitions, motion | `frontend-design/motion-design` |
| Express routes, controllers, middleware | `backend-patterns` |
| Fastify services, NATS consumers | `v4-service-patterns` |
| SQL migrations, schema changes | `database-migrations` |
| Tests | `testing` |

### 3. Inspect Existing Implementation

Before writing code:
- Read the files you plan to modify
- Read adjacent files in the same module/feature
- Check how similar features are already implemented
- Look for existing patterns that your change should follow

### 4. Trace the Data Flow

For any feature touching data:
- Where does the data enter? (API route, worker, webhook, realtime event)
- How is it stored? (which table, with RLS?)
- How does it reach the frontend? (REST response, Centrifugo publish, polling)
- Who can access it? (which roles, which auth model)

### 5. Plan the Minimal Change

Identify the smallest set of files that need to change. Do not:
- Refactor surrounding code unless asked
- Add abstractions for single-use patterns
- Create new files when editing existing ones works
- Touch files outside the affected domain

### 6. Implement

Follow the patterns established in the relevant domain skill(s).

### 7. Test

- Run the relevant test suite (see `testing` skill)
- For frontend: start dev server and visually verify
- For API changes: verify the endpoint works as expected

### 8. Security and Tenant Review

For any change involving data:
- Does the new/modified query go through `req.db` (org-scoped)?
- If a new table was added, does it have `org_id`, RLS enabled, and a policy?
- Does the endpoint have appropriate `authorize()` middleware?
- Are user inputs validated?

### 9. Regression Check

- Does the change break any existing route, component, or worker?
- Does the change affect the contracts package? If so, `pnpm build:contracts` first.
- Does the change affect shared middleware or utilities?

### 10. Report What Changed

End with a concise summary:
- Which files were modified/created
- What the change does
- What was tested
- Any cross-domain impacts

## Do

- Always read before editing
- Follow existing patterns in each domain
- Keep changes minimal and focused
- Check multi-tenancy implications for any database work
- Check auth implications for any API work

## Don't

- Start coding before identifying the affected domain
- Modify files in multiple unrelated domains without justification
- Create new abstractions for single-use cases
- Skip the security/tenant review for data-touching changes
- Assume a request is simple without checking the data flow
