# HRMS server (API) on the Hostinger VPS

Live since 2026-10-26 at **https://hrms.stencilindia.com** (`/health` shows status and uptime).

| Part | Where |
| --- | --- |
| API | Hostinger VPS `187.127.175.111` (`srv1716952`), PM2 process **`stencil-hrms-api`**, port 5060 |
| HTTPS | nginx site `/etc/nginx/sites-available/stencil-hrms-api` + Let's Encrypt (certbot renews it) |
| Code | `/var/www/stencil-hrms` (a clone of this repo) |
| Settings | `/var/www/stencil-hrms/apps/api/.env` (template: `.env.example` here) |
| Website | Vercel; `apps/web/vercel.json` forwards `/api` to the VPS |
| Database / files | MongoDB Atlas / Cloudinary (unchanged) |
| DNS | GoDaddy (`stencilindia.com`): A record `hrms` → `187.127.175.111` |

The VPS also runs other apps under PM2 (sales, OMS, inventory, GRN, and an unrelated `hrms-api`).
Only ever touch `stencil-hrms-api` and the `stencil-hrms-api` nginx site.

## Update after a push

On the VPS as root:

```bash
/var/www/stencil-hrms/deploy/vps/update.sh
```

It pulls `main`, installs, builds and restarts `stencil-hrms-api` (only if the build succeeded).

## Everyday commands

| What | Command |
| --- | --- |
| Status | `pm2 list` |
| Logs | `pm2 logs stencil-hrms-api --lines 100` |
| Restart (e.g. after editing `.env`) | `pm2 restart stencil-hrms-api` |
| Health | `curl https://hrms.stencilindia.com/health` |
| nginx check / apply | `nginx -t` then `systemctl reload nginx` |

## How it was set up (to redo on a new server)

1. DNS A record → the VPS IP; MongoDB Atlas → Network Access → allow the VPS IP.
2. Node.js 20+ and nginx installed; port 5060 free (`ss -tlnp | grep ':5060 '`).
3. `git clone https://github.com/Nivedajain25/HRMS.git /var/www/stencil-hrms`
4. In `/var/www/stencil-hrms`:
   `npx -y pnpm@10.18.0 install --frozen-lockfile --filter "@stencil/api..." --config.store-dir=/root/.pnpm-store --config.virtual-store-dir=node_modules/.pnpm`
   then `npx -y pnpm@10.18.0 --filter @stencil/api build`
   (pnpm via npx, so nothing global changes for the other apps; the repo `.npmrc` store paths are Windows-only,
   hence the overrides).
5. `apps/api/.env` from `.env.example`, `chmod 600`.
6. `pm2 start /var/www/stencil-hrms/apps/api/dist/server.js --name stencil-hrms-api --cwd /var/www/stencil-hrms/apps/api --max-memory-restart 500M`
   then `pm2 save`.
7. nginx: `nginx-stencil-hrms-api.conf` → `/etc/nginx/sites-available/stencil-hrms-api`, link it into
   `sites-enabled`, `nginx -t`, `systemctl reload nginx`.
8. `certbot --nginx -d hrms.stencilindia.com`

## Switching off Railway

Once the website and the new app build use the VPS: delete the HRMS service in Railway (or let the trial end),
then on the VPS set `ENABLE_JOBS=true` in `apps/api/.env` and `pm2 restart stencil-hrms-api`.

## Automatic updates (optional)

`.github/workflows/deploy-vps.yml` runs `update.sh` over SSH after pushes that change the API. It stays off until
GitHub → Settings → Secrets and variables → Actions has: variable `VPS_HOST` (`187.127.175.111`), optional
`VPS_USER` (default `root`), and secret `VPS_SSH_KEY` (a private key whose public half is in that user's
`~/.ssh/authorized_keys` on the VPS).
