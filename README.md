# Stencil HRMS

**Stencil HRMS** is a multi-tenant human resource management platform: people, organization structure, attendance & shifts, leave, payroll & payslips, performance, recruitment (ATS), onboarding/offboarding, documents, assets, expenses, announcements, notifications, reports and audit — in one modular TypeScript monorepo.

- **Frontend:** React 19 · Vite · TypeScript · Tailwind CSS v4 · React Router 7 · TanStack Query & Table · Zustand · React Hook Form + Zod · Recharts · Lucide
- **Backend:** Node.js · Express 5 · TypeScript · MongoDB · Mongoose 8 · Zod · JWT (access + rotating refresh) · Argon2id · Helmet · rate limiting · Nodemailer · BullMQ/Redis (optional) · PDFKit · ExcelJS
- **Infra:** Docker Compose (web/nginx, api, worker, MongoDB replica set, Redis), OpenAPI/Swagger, Vitest + Supertest, Playwright

---

## Contents

1. [Features](#features)
2. [Architecture](#architecture)
3. [Requirements](#requirements)
4. [Quick start](#quick-start)
5. [Environment variables](#environment-variables)
6. [MongoDB](#mongodb)
7. [Redis & background jobs](#redis--background-jobs)
8. [Development](#development)
9. [Seed data & demo accounts](#seed-data--demo-accounts)
10. [Testing](#testing)
11. [Build](#build)
12. [Docker](#docker)
13. [API & Swagger](#api--swagger)
14. [Security model](#security-model)
15. [Deployment](#deployment)
16. [Troubleshooting](#troubleshooting)

---

## Features

| Area | Highlights |
| --- | --- |
| **Auth** | Organization registration (org + Super Admin), login with lockout, remember-me, rotating refresh tokens in HTTP-only cookies with reuse detection, logout / logout-everywhere, email verification, forgot/reset password, invitations, change password, session list & revoke |
| **RBAC** | 8 system roles (Super Admin, HR Admin, HR Manager, Manager, Employee, Recruiter, Payroll Admin, Finance), custom roles, 50+ granular permissions, privilege-escalation guards, permission-aware navigation |
| **Multi-tenancy** | Every document carries `organizationId`, derived from the authenticated user only; cross-tenant ids are indistinguishable from missing ones; referenced ids are validated in-tenant |
| **People** | Employees (identity, contact, address, employment, bank, emergency, configurable identity numbers — encrypted at rest), departments (hierarchy, heads), designations (levels), locations (geofence), org chart, employment history (department/designation/manager/salary/location/shift/status), self-service profile |
| **Attendance** | Clock in/out, breaks, working/break/overtime/late/early calculations per shift (incl. night & flexible shifts), office/remote modes, geofencing, optional selfie (front camera) + GPS capture at clock in/out with per-org enforcement and restricted photo visibility, dashboard & trends, regularization with multi-step approvals, nightly auto-absent/holiday/week-off/leave marking and auto clock-out |
| **Shifts & holidays** | Shift CRUD, dated assignments (employee/department), schedule grid, shift history; public/company/optional/regional, location-specific and recurring holidays |
| **Leave** | Configurable leave types (allowance, annual/monthly accrual, carry-forward caps, encashment flag, half days, document rules, notice, max consecutive, gender applicability, WFH), working-day calculation (weekends/holidays/half-days/timezone), overlap prevention, drafts, approval chains, transactional balance ledger (allocated/opening/used/pending/remaining/carry-forward), calendar, adjustments, year-end carry forward |
| **Payroll** | Configurable salary components (fixed, % of basic, % of gross, slabs, caps, eligibility thresholds, employer contributions, proration), versioned salary structures & salary history, loans/advances, one-off adjustments, attendance/LOP-aware payroll runs (DRAFT → PROCESSING → REVIEW → APPROVED → PAID), maker-checker approval, PDF payslips, CSV/XLSX export, country rule packs as editable templates (no compliance claims) |
| **Performance** | Cycles with configurable rating scales, goals/KPIs/OKRs with weights & key results, progress updates, self → manager → HR reviews, weighted final ratings, feedback with visibility |
| **Recruitment** | Job openings, candidates, validated pipeline (APPLIED → … → HIRED/REJECTED), kanban, interviews with conflict detection & feedback, hiring that converts a candidate into an employee + user + onboarding |
| **Lifecycle** | Onboarding templates & checklists with progress; offboarding workflow (notice → asset return → clearance → final payroll → exit interview → deactivation) with gates |
| **Documents** | Uploads validated by magic bytes, private storage (local or S3), preview/download through authorized endpoints only, versioning, verification, expiry reminders |
| **Assets & expenses** | Asset inventory & assignment workflow with history; expenses with receipts, approval chains and payment |
| **Communication** | Announcements (sanitized rich text, targeting, scheduling, read tracking), in-app + email notifications with per-user preferences |
| **Insights** | Admin/manager/employee dashboards on live data, 8 reports exportable to CSV/Excel/PDF, global search, append-only audit log |
| **UX** | Responsive (mobile self-service tab bar), light/dark/system themes, keyboard & screen-reader friendly components, skeletons, empty & error states |

## Architecture

```
stencil-hrms/
├── apps/
│   ├── api/            Express API (modular monolith)
│   │   └── src/
│   │       ├── config/        env (validated with Zod), logger (pino, redaction), database
│   │       ├── routes/        module routers built with createModule()/route() → auth, RBAC, validation, OpenAPI
│   │       ├── controllers/   thin request/response adapters
│   │       ├── services/      business logic (every function receives the tenant-scoped RequestContext)
│   │       ├── models/        Mongoose schemas (timestamps, enums, indexes, soft delete)
│   │       ├── middleware/    auth, validation, security, uploads, errors
│   │       ├── payroll/       core engine, rules hooks, country packs
│   │       ├── jobs/          queue abstraction (BullMQ or in-process), scheduler, worker
│   │       ├── emails/ pdf/ reports/ storage/ integrations/ seed/
│   │       └── app.ts, server.ts
│   └── web/            React SPA
│       └── src/
│           ├── app/ components/ features/<module>/ hooks/ layouts/ lib/ routes/ store/ styles/
├── packages/
│   ├── shared/         permissions, enums, workflow state machines, Zod schemas (used by API and web)
│   ├── types/          API envelope & DTO types
│   └── config/         shared tsconfig
├── docker/             Dockerfiles, nginx config
├── docs/               backend & frontend conventions
└── docker-compose.yml
```

Request flow: `Route → Middleware (auth, permission, Zod validation) → Controller → Service → Model → MongoDB`.

Key design decisions:

- **Single source of truth for contracts** — the same Zod schemas validate API input and power frontend forms; workflow transitions (`LEAVE_WORKFLOW`, `PAYROLL_WORKFLOW`, `CANDIDATE_PIPELINE`, …) live in `packages/shared/src/workflows.ts` and are enforced server-side.
- **Reusable approval engine** (`services/approval.service.ts`) drives leave, regularization and expense approvals with per-organization chains (Manager → HR → Finance …), skip-level/HR override, no self-approval and "awaiting me" queues.
- **Data scopes** — `<module>:read` grants org-wide access, `team:view` grants self + direct/indirect reports (resolved with `$graphLookup`), otherwise self only. Single-record endpoints re-check access (IDOR protection).
- **Transactions** for multi-document invariants (leave approval + balance, payroll processing + payslips, employee creation + onboarding + balances, hiring). They run on replica sets; on a standalone dev server they degrade gracefully.
- **Dates** — instants in UTC; calendar dates stored at 00:00 UTC and computed in the organization's timezone.

See [`docs/BACKEND-CONVENTIONS.md`](docs/BACKEND-CONVENTIONS.md) and [`docs/FRONTEND-CONVENTIONS.md`](docs/FRONTEND-CONVENTIONS.md).

## Requirements

- Node.js **20+** (22 LTS recommended) with Corepack (`corepack enable`)
- pnpm 10 (installed automatically through Corepack from `packageManager`)
- MongoDB **7+** as a **replica set** (single node is fine) — or use the in-memory dev mode below
- Redis 7 (optional — only for BullMQ background jobs)
- Docker & Docker Compose (optional)

## Quick start

```bash
corepack enable
pnpm install
cp .env.example .env            # set JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, FIELD_ENCRYPTION_KEY
pnpm dev:memory                 # API on an in-memory MongoDB replica set, pre-seeded + web app
```

Open http://localhost:5173 and sign in with a [demo account](#seed-data--demo-accounts). No MongoDB installation is needed for `dev:memory` (a MongoDB binary is downloaded to `~/.cache/mongodb-binaries` on first run). Data is discarded when the process stops.

With your own MongoDB:

```bash
pnpm seed      # optional demo data
pnpm dev       # API on :5000, web on :5173 (Vite proxies /api)
```

> **Local note (this workstation):** the repository drive is small, so `.npmrc` places pnpm's store and virtual store on `C:\stencil-hrms-pnpm`. Remove those two lines on other machines if you prefer the defaults.

## Environment variables

All variables are documented in [`.env.example`](.env.example) and validated at startup (the API refuses to start with invalid configuration). Development defaults exist for secrets; **production requires** `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` and `FIELD_ENCRYPTION_KEY` (≥ 32 chars each).

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | MongoDB connection string (replica set for transactions) |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Token signing / refresh-token HMAC secrets |
| `JWT_ACCESS_EXPIRES`, `JWT_REFRESH_EXPIRES`, `JWT_REFRESH_SHORT_EXPIRES` | Lifetimes (e.g. `15m`, `7d`, `1d`) |
| `FIELD_ENCRYPTION_KEY` | AES-256-GCM key material for bank & identity numbers |
| `CLIENT_URL`, `API_URL` | Allowed CORS origin(s) and public API URL (Swagger / emails) |
| `COOKIE_SECURE`, `COOKIE_DOMAIN`, `TRUST_PROXY` | Cookie & proxy settings (set `COOKIE_SECURE=true` behind HTTPS) |
| `SMTP_*`, `EMAIL_FROM` | Outgoing email (empty `SMTP_HOST` = render & log only) |
| `STORAGE_PROVIDER`, `STORAGE_LOCAL_DIR`, `AWS_*`, `S3_ENDPOINT`, `MAX_UPLOAD_MB` | File storage: `mongo` (default — uploads such as clock-in selfies live in the database and survive redeploys), `local` (server disk) or `s3` |
| `REDIS_URL`, `ENABLE_JOBS`, `RUN_WORKER` | Background jobs |
| `LOG_LEVEL`, `ENABLE_SWAGGER` | Logging / API docs in production |

## MongoDB

Transactions require a replica set. To run a single-node replica set locally:

```bash
mongod --replSet rs0 --dbpath ./data
mongosh --eval "rs.initiate()"
# MONGODB_URI=mongodb://127.0.0.1:27017/stencil_hrms?replicaSet=rs0
```

Indexes are created automatically on startup (tenant-first compound indexes for common queries, unique constraints per organization, TTL indexes for sessions/tokens/notifications/email logs).

## Redis & background jobs

Jobs: email delivery, notifications, document-expiry reminders, birthday/anniversary reminders, announcement publishing, nightly attendance marking & auto clock-out, monthly leave accrual, year-end carry forward.

- **Without Redis** (`REDIS_URL` empty): jobs run in-process; the scheduler runs inside the API.
- **With Redis**: jobs go through BullMQ with retries/backoff. Run a dedicated worker with `pnpm --filter @stencil/api worker` (after build) or `worker:dev`, and set `RUN_WORKER=false` / `ENABLE_JOBS=false` on API instances so only the worker schedules jobs.

## Development

| Command | Description |
| --- | --- |
| `pnpm dev` | API (tsx watch) + web (Vite) |
| `pnpm dev:memory` | Same, against an in-memory seeded MongoDB replica set |
| `pnpm typecheck` | Strict TypeScript for shared, api and web |
| `pnpm lint` / `pnpm lint:fix` | ESLint (flat config) |
| `pnpm format` | Prettier |
| `pnpm test` | API unit & integration tests |
| `pnpm test:e2e` | Playwright end-to-end tests |
| `pnpm build` | Production builds (api via tsup, web via Vite) |
| `pnpm seed` | Load demo data |

## Seed data & demo accounts

`pnpm seed` creates the fictional organization **Stencil Demo Co.** (timezone Asia/Kolkata, INR, India payroll template) with departments, designations, locations, shifts, holidays, ~30 employees, salary structures, attendance history, leave requests, jobs & candidates, a performance cycle with goals, assets, expenses, announcements and an onboarding. It only replaces the demo organization — other tenants are untouched.

All demo users share the password **`Demo@12345`**:

| Role | Email |
| --- | --- |
| Super Admin | `superadmin@stencil-demo.test` |
| HR Admin | `hr@stencil-demo.test` |
| HR Manager | `hrmanager@stencil-demo.test` |
| Manager | `manager@stencil-demo.test` |
| Employee | `employee@stencil-demo.test` |
| Recruiter | `recruiter@stencil-demo.test` |
| Payroll Admin | `payroll@stencil-demo.test` |
| Finance | `finance@stencil-demo.test` |

All names and emails are fictional. **Never** run the seed against production data.

## Testing

- **API** (`apps/api/tests`): Vitest + Supertest against an in-memory MongoDB replica set (transactions included). Unit tests cover calculation engines (attendance, leave days, payroll, performance scoring, CSV); integration tests cover every module end to end — authentication & token rotation, RBAC & privilege escalation, tenant isolation, IDOR, workflows and state-transition validation, file validation, reports and seed.
- **E2E** (`apps/web/e2e`): Playwright scenario — admin creates an employee → employee clocks in and applies for leave → manager approves → balance updates → payroll is processed → payslip is downloaded.

```bash
pnpm test
pnpm test:e2e      # starts API (in-memory DB) + web automatically; first run: pnpm --filter @stencil/web exec playwright install chromium
PW_CHANNEL=chrome pnpm test:e2e   # use an installed Chrome/Edge (msedge) instead of the bundled Chromium
```

The E2E suite is rerunnable against a reused dev server: it picks fresh leave dates and continues an existing payroll run for the month.

## Build

```bash
pnpm build
node apps/api/dist/server.js        # API
node apps/api/dist/worker.js        # optional dedicated worker
# serve apps/web/dist with any static server that proxies /api to the API (see docker/nginx.conf)
```

## Docker

```bash
cp .env.example .env   # set the three secrets
docker compose up -d --build
docker compose exec api node dist/seed.js   # optional demo data
```

Services: `web` (nginx serving the SPA and proxying `/api` → same-origin cookies) on http://localhost:8080, `api`, `worker` (BullMQ consumer + scheduler), `mongodb` (single-node replica set, auto-initiated), `redis`. Uploaded files persist in the `uploads` volume (or use S3).

## API & Swagger

- Base URL: `/api/v1`
- Envelope: `{ success, data, message }`; lists add `pagination: { page, limit, total, totalPages }`; errors `{ success: false, message, code, errors: [{ path, message }] }`
- Pagination/filtering/sorting: `?page=1&limit=20&search=…&sortBy=…&sortOrder=asc|desc` + module filters
- OpenAPI document generated from the route registry and Zod schemas: `GET /api/docs.json`; Swagger UI at `/api/docs` (development, or `ENABLE_SWAGGER=true`)
- Health: `GET /health` → API, database and job-queue status

## Security model

- Argon2id password hashing; generic login errors; timing-equalized unknown-user path; account lockout after configurable failed attempts; auth endpoint rate limiting
- Short-lived access JWT (memory only on the client) + opaque rotating refresh token in an HTTP-only `SameSite=Strict` cookie, hashed at rest, with family revocation on reuse; CSRF header required on cookie endpoints; `tokenVersion` invalidates all tokens on password reset, deactivation or logout-everywhere
- Helmet, strict CORS allow-list, request size limits, recursive stripping of `$`/dotted keys (NoSQL injection), Zod validation on every input
- Tenant isolation on every query, in-tenant reference validation, IDOR checks on single-record endpoints, permission checks on every mutation, escalation-proof role management (can't grant permissions you don't hold, last Super Admin protected)
- Bank and identity numbers encrypted with AES-256-GCM, masked for users without `employee:read_sensitive`; salary visible only to the employee and salary/payroll roles
- Uploads: size limits, magic-byte MIME validation, random storage keys, private storage, `nosniff` and sandboxed responses, no public URLs
- Sanitized rich text for announcements; CSV formula-injection neutralization in exports
- Structured logs with redaction of passwords, tokens, cookies, bank and identity data; append-only audit log (model rejects updates/deletes)

## Deployment

The full runbook — topology, secrets, TLS, scaling, backups, upgrades, monitoring, go-live checklist and incident playbooks — is in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). CI (typecheck, lint, tests, build, Playwright) is defined in [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

1. Provision MongoDB (replica set / Atlas), optionally Redis, and S3-compatible storage for multi-instance deployments.
2. Set production environment variables (strong random secrets, `NODE_ENV=production`, `COOKIE_SECURE=true`, `TRUST_PROXY=true` behind a load balancer, `CLIENT_URL` = your domain).
3. Build images with the provided Dockerfiles (or `pnpm build`) and run `api` (N replicas), `worker` (1+) and `web` behind HTTPS.
4. Serve the SPA and API from the **same origin** (as nginx does) so refresh cookies stay first-party.
5. Back up MongoDB and the storage bucket; keep `FIELD_ENCRYPTION_KEY` safe — losing it makes encrypted fields unreadable.
6. Monitor `GET /health` and structured logs.

Payroll rule packs are editable templates. Review every statutory component with a qualified payroll professional before paying salaries — Stencil does not claim legal compliance for any jurisdiction.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Invalid environment configuration` at startup | A required variable is missing or too short — see the listed keys |
| `Transaction numbers are only allowed on a replica set member` | Run MongoDB as a replica set (`--replSet rs0` + `rs.initiate()`) |
| Signed out on every refresh in production | Serve web and API from the same origin over HTTPS, set `COOKIE_SECURE=true` and `TRUST_PROXY=true` |
| Emails not delivered | Configure `SMTP_*`; check Settings → Email → "Send test email" |
| `dev:memory` slow on first run | The MongoDB binary (~600 MB) is downloading to `~/.cache/mongodb-binaries` |
| Uploads rejected as unsupported | Only PDF, PNG, JPEG, WebP, DOCX and XLSX are accepted (validated by content, not extension) |
| Jobs not running | Without Redis they run in-process with `ENABLE_JOBS=true`; with Redis make sure a worker is running |

## License

Proprietary — © Stencil. All rights reserved. See [LICENSE](LICENSE).
