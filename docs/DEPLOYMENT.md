# Deployment runbook

This runbook takes Stencil HRMS from a fresh server to production, and covers day-2 operations (upgrades, backups, scaling, incidents).

## 1. Topology

```
            HTTPS (443)
 Users ───► Reverse proxy / load balancer (TLS termination)
                 │
                 ▼
            web (nginx: SPA + /api proxy)  ──►  api × N  ──►  MongoDB replica set
                                                  │   ▲
                                                  ▼   │
                                          Redis ◄── worker × 1+   ──►  SMTP
                                                  │
                                            S3-compatible bucket (files)
```

- **web** serves the React build and proxies `/api` to the API, so the refresh-token cookie is first-party (same origin). Keep this same-origin layout.
- **api** is stateless: run as many replicas as needed.
- **worker** consumes BullMQ jobs (emails, notifications, reminders, nightly attendance, accruals) and runs the scheduler. Run **one scheduler** (default worker behaviour); additional workers can set `RUN_SCHEDULER=false`.
- **MongoDB must be a replica set** (Atlas, or self-hosted with ≥ 3 members in production). Transactions are required for leave approvals, payroll processing and hiring.
- **Files**: use S3 (or MinIO/R2/Spaces) when running more than one API instance. The local provider is only suitable for a single host with a persistent volume.

## 2. Prerequisites

| Component | Minimum | Notes |
| --- | --- | --- |
| Docker Engine + Compose v2 | 24+ | or any container platform (ECS, Kubernetes, Fly, Render…) |
| MongoDB | 7.0, replica set | Atlas M10+ recommended; enable backups |
| Redis | 7 | persistence (AOF) on; required for the separate worker |
| SMTP | any | SES, Postmark, SendGrid, Mailgun… |
| Object storage | S3 API | private bucket, SSE enabled |
| Domain + TLS | — | e.g. `hr.example.com` |

## 3. Secrets

Generate each secret independently (≥ 32 chars):

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

| Secret | Rotation impact |
| --- | --- |
| `JWT_ACCESS_SECRET` | Rotating signs everyone out within the access-token lifetime (15 min) |
| `JWT_REFRESH_SECRET` | Rotating invalidates all sessions immediately (users sign in again) |
| `FIELD_ENCRYPTION_KEY` | **Never rotate casually.** It encrypts bank and identity numbers; changing it makes existing values unreadable. Store it in a secret manager with backups. |
| `SMTP_PASSWORD`, `AWS_SECRET_ACCESS_KEY` | Rotate per provider policy |

Keep secrets in your platform's secret store (AWS Secrets Manager, Vault, Doppler, GitHub Environments) — never in the image or the repository.

## 4. Configuration

Start from [`.env.example`](../.env.example). Production values that differ from development:

```env
NODE_ENV=production
CLIENT_URL=https://hr.example.com
API_URL=https://hr.example.com
MONGODB_URI=mongodb+srv://stencil:<password>@cluster0.xxxx.mongodb.net/stencil_hrms?retryWrites=true&w=majority
REDIS_URL=redis://:<password>@redis:6379
COOKIE_SECURE=true
TRUST_PROXY=true
STORAGE_PROVIDER=s3
AWS_REGION=ap-south-1
AWS_BUCKET=stencil-hrms-files
SMTP_HOST=email-smtp.ap-south-1.amazonaws.com
SMTP_PORT=587
EMAIL_FROM="Stencil HRMS <hr-noreply@example.com>"
ENABLE_SWAGGER=false
# API replicas: the worker owns jobs & scheduling
RUN_WORKER=false
ENABLE_JOBS=false
```

The API validates configuration at startup and exits with a list of problems if anything is missing or invalid.

### S3 bucket policy

- Block all public access; objects are served only through `GET /api/v1/files/:id` after authorization.
- Enable default encryption (SSE-S3 or SSE-KMS) and versioning.
- IAM user/role needs `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` on `arn:aws:s3:::stencil-hrms-files/*` only.

## 5. First deployment (Docker Compose)

```bash
git clone <repo> stencil-hrms && cd stencil-hrms
cp .env.example .env        # fill in secrets and production values
docker compose build
docker compose up -d
docker compose ps           # all services healthy
curl -fsS http://localhost:8080/health
```

The bundled `docker-compose.yml` runs MongoDB and Redis as containers — fine for a pilot. For production, point `MONGODB_URI`/`REDIS_URL` at managed services and remove those two services.

**Do not run the demo seed in production.** Create the first organization at `https://hr.example.com/register`; the registering user becomes its Super Admin. Then:

1. Settings → Organization: legal name, timezone, currency, working days, employee ID prefix.
2. Settings → Payroll: rule pack (review every statutory component with a payroll professional).
3. Settings → Approvals: approval chains.
4. Settings → Email: "Send test email".
5. People → Departments / Designations / Locations, Attendance → Shifts / Holidays, Leave → Leave Types.
6. Add employees (they receive invitations).

## 6. TLS / reverse proxy

Terminate TLS in front of the `web` container. Example with Caddy (automatic certificates):

```caddyfile
hr.example.com {
  encode gzip
  reverse_proxy web:80
}
```

Example with nginx on the host:

```nginx
server {
  listen 443 ssl http2;
  server_name hr.example.com;
  ssl_certificate     /etc/letsencrypt/live/hr.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/hr.example.com/privkey.pem;
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  client_max_body_size 12m;
  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
  }
}
```

With a proxy in front, keep `TRUST_PROXY=true` so rate limiting and audit logs record real client IPs.

## 7. Scaling

- **API**: scale horizontally (`docker compose up -d --scale api=3` behind the web container, or separate services behind a load balancer). CPU-bound work: PDF generation, payroll processing, report exports.
- **Worker**: one instance runs the scheduler; add more with `RUN_SCHEDULER=false` for throughput.
- **MongoDB**: indexes are created on startup. For large tenants, monitor slow queries (Atlas Performance Advisor) — every query is tenant-scoped with `organizationId`-prefixed indexes.
- **Rate limits** are per API instance (in-memory). For strict global limits across many replicas, put a limiter at the proxy/WAF.

## 8. Backups & restore

| Data | Method | Frequency / retention |
| --- | --- | --- |
| MongoDB | Atlas continuous backup (point-in-time) or `mongodump --gzip --archive` | PITR 7 days + daily snapshots 30 days |
| Files | S3 versioning + lifecycle, or cross-region replication | versions kept 90 days |
| Secrets | secret manager backup (especially `FIELD_ENCRYPTION_KEY`) | on change |

Restore drill (quarterly):

```bash
mongorestore --gzip --archive=stencil-2026-09-23.gz --nsInclude='stencil_hrms.*' --uri "$RESTORE_URI"
```

Start a staging stack against the restored database with the **same** `FIELD_ENCRYPTION_KEY`, sign in, and verify an employee's bank details decrypt.

## 9. Upgrades & rollback

1. Read the release notes; take a database snapshot.
2. `git pull && docker compose build`
3. `docker compose up -d` (API/worker restart; the SPA is replaced atomically — users on an old tab get "A new version is available" and reload).
4. Check `/health`, sign in, open the dashboard, and watch error logs for 15 minutes.

Rollback: redeploy the previous image tag. Schema changes are additive (new optional fields/indexes); if a release notes a data migration, restore the pre-upgrade snapshot to roll back.

## 10. Monitoring

- **Health**: `GET /health` → `200 {status:"ok", database:"connected", jobs:"redis"}`; `503` when the database is unreachable. Use it for load-balancer and uptime checks.
- **Logs**: JSON (pino) to stdout — ship to your log platform. Secrets, tokens, bank and identity fields are redacted at the logger. Alert on `level >= 50` (error) rate and on `Refresh token reuse detected` warnings (possible token theft).
- **Jobs**: BullMQ failed-job counts in Redis; email delivery status is kept in the `emaillogs` collection (90-day TTL).
- **Audit**: Settings → Audit log (or `GET /api/v1/audit-logs`) for who changed what.

## 11. Security checklist (go-live)

- [ ] HTTPS only, HSTS enabled, `COOKIE_SECURE=true`, `TRUST_PROXY=true`
- [ ] Strong, unique secrets from a secret manager; `FIELD_ENCRYPTION_KEY` backed up
- [ ] MongoDB: auth enabled, network access restricted to the app, TLS in transit, backups on
- [ ] Redis: password + private network only
- [ ] S3 bucket private, encrypted, least-privilege credentials
- [ ] `ENABLE_SWAGGER=false` (or restrict `/api/docs` at the proxy)
- [ ] SPF/DKIM/DMARC configured for `EMAIL_FROM` domain
- [ ] Demo seed **not** run; no `@stencil-demo.test` accounts exist
- [ ] Super Admin accounts limited to named individuals
- [ ] Payroll components reviewed by a qualified payroll professional before the first real run

## 12. Incident playbooks

| Situation | Action |
| --- | --- |
| Suspected account compromise | Settings → Users → Suspend (revokes all sessions immediately); ask the user to reset their password |
| Leaked refresh/JWT secret | Rotate `JWT_REFRESH_SECRET` and `JWT_ACCESS_SECRET`, redeploy — everyone signs in again |
| Database unreachable | `/health` returns 503; API requests fail fast. Restore connectivity; no manual recovery needed |
| Emails not arriving | Settings → Email shows SMTP status; check `emaillogs` for `FAILED` with the provider error |
| Payroll approved with an error | Reopen (APPROVED → REVIEW), fix salary/adjustments, re-process, re-approve. Paid runs are immutable — correct via adjustments in the next period |
| Wrong attendance for a day | Employee submits a regularization, or HR edits the record (audited) |
