# syntax=docker/dockerfile:1.7
# ── Build stage ──────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
# Install with a manifest-only layer for better caching.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY packages/types/package.json packages/types/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# The repo .npmrc points the store at a local Windows path; ignore it in containers.
RUN pnpm install --frozen-lockfile --filter @stencil/api... --config.store-dir=/pnpm-store
COPY packages packages
COPY apps/api apps/api
RUN pnpm --filter @stencil/api build \
 && pnpm --filter @stencil/api deploy --prod --legacy /out --config.store-dir=/pnpm-store

# ── Runtime stage ────────────────────────────────────────────
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S stencil && adduser -S stencil -G stencil && mkdir -p /app/uploads && chown stencil:stencil /app/uploads
COPY --from=build --chown=stencil:stencil /out/node_modules ./node_modules
COPY --from=build --chown=stencil:stencil /app/apps/api/dist ./dist
COPY --from=build --chown=stencil:stencil /app/apps/api/package.json ./package.json
USER stencil
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5000/health || exit 1
CMD ["node", "dist/server.js"]
