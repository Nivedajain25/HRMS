#!/usr/bin/env sh
# Pulls main, rebuilds the API and restarts it under PM2. Run on the VPS as root (also called by the deploy workflow).
# The running server is only restarted once the build has succeeded.
set -eu
cd "$(dirname "$0")/../.."
git pull --ff-only
npx -y pnpm@10.18.0 install --frozen-lockfile --filter "@stencil/api..." --config.store-dir=/root/.pnpm-store --config.virtual-store-dir=node_modules/.pnpm
npx -y pnpm@10.18.0 --filter @stencil/api build
pm2 restart stencil-hrms-api
