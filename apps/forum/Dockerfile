# syntax=docker/dockerfile:1
# eno.forum — Cloud Run image (build context = apps/forum; independent app with
# its own lockfile, no Prisma, no ffmpeg). Same shape as the marketplace image.

# ---------- deps ----------
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# ---------- builder: next build → .next/standalone ----------
FROM node:24-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Build-time env via BuildKit secret (NEXT_PUBLIC_* inlined into the client;
# the CSP in next.config.ts reads NEXT_PUBLIC_SUPABASE_URL at build).
RUN --mount=type=secret,id=buildenv \
    sh -c 'set -a; [ -f /run/secrets/buildenv ] && . /run/secrets/buildenv; set +a; npm run build'

# ---------- runner ----------
FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8080
ENV HOSTNAME=0.0.0.0
RUN groupadd -g 1001 nodejs && useradd -u 1001 -g nodejs -m nextjs
# Forum's build script is a bare `next build` — nest static/ and public/ here.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
USER nextjs
EXPOSE 8080
# Runtime env: Secret Manager volume at /secrets/env (dotenv), sourced then exec —
# same contract as the marketplace image.
CMD ["sh", "-c", "set -a; [ -f /secrets/env ] && . /secrets/env; set +a; exec node server.js"]
