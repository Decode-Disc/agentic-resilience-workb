# syntax=docker/dockerfile:1

# ────────────────────────────────────────────────────────────────────────────
# BASE: Official Playwright Docker image (Ubuntu noble, Chromium + deps,
# pwuser pre-installed). CORE #1 (glibc, not Alpine) + CORE #5 (pinning).
# ────────────────────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/playwright:v1.62.1-noble AS base

# ────────────────────────────────────────────────────────────────────────────
# BUILDER: install all deps, compile TypeScript, prune to production-only.
# ────────────────────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app

# CORE #2 (layer order): manifests before source for cache reuse.
COPY package.json package-lock.json ./

# EXTRA #8 (cache mount): persist npm cache across rebuilds.
RUN --mount=type=cache,target=/root/.npm \
    npm ci

COPY . .
RUN npm run build && \
    npm prune --omit=dev

# ────────────────────────────────────────────────────────────────────────────
# RUNTIME: production node_modules + compiled dist + run as non-root pwuser.
# ────────────────────────────────────────────────────────────────────────────
FROM base AS runtime
WORKDIR /app

ENV NODE_ENV=production

# Copy production artifacts from the builder stage.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# EXTRA #6 (non-root user): pwuser already exists in the Playwright image.
RUN chown -R pwuser:pwuser /app

USER pwuser

EXPOSE 3000

# EXTRA #7 (HEALTHCHECK): Node has global fetch(); no curl needed.
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
