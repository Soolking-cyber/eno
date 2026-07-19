# syntax=docker/dockerfile:1
# Production image for Cloud Run (Singapore). Builds the Next.js standalone server
# (next.config.ts emits `output: "standalone"` whenever VERCEL is unset) into a
# non-root runtime that listens on $PORT. Prisma 7 has no Rust engine and the pg
# driver is pure JS — but the base is debian-slim, NOT alpine: ffmpeg-static (the
# video transcode route) ships a glibc binary that ENOENTs on musl.

# ---------- deps: install node_modules (incl. dev, needed to build) ----------
FROM node:24-slim AS deps
WORKDIR /app
# prisma.config.ts EAGERLY resolves env('DIRECT_URL') when the CLI loads it, and
# postinstall runs `prisma generate` — generate never connects, so a placeholder
# satisfies the config here. The real value arrives in the builder stage's secret.
ENV DIRECT_URL="postgresql://build:build@localhost:5432/build"
COPY package.json package-lock.json* ./
# `npm ci` runs the postinstall `prisma generate`; the schema is needed for that.
# (Install scripts must run: ffmpeg-static downloads its platform binary there.)
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci

# ---------- builder: next build → .next/standalone ----------
FROM node:24-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Build-time env arrives as a BuildKit secret (docker build --secret id=buildenv,src=…):
# NEXT_PUBLIC_* values are INLINED into the client bundle, and DATABASE_URL is read if
# any route pre-renders against the DB. A secret mount — unlike --build-arg — never
# lands in image history or layer metadata, and nothing here reaches the runtime layer.
RUN --mount=type=secret,id=buildenv \
    sh -c 'set -a; [ -f /run/secrets/buildenv ] && . /run/secrets/buildenv; set +a; npm run build'

# ---------- runner: minimal non-root server ----------
FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Cloud Run injects PORT (default 8080) and expects the server bound to 0.0.0.0.
ENV PORT=8080
ENV HOSTNAME=0.0.0.0
RUN groupadd -g 1001 nodejs && useradd -u 1001 -g nodejs -m nextjs
# The standalone bundle is self-contained; static/ and public/ are copied alongside it
# (the build script already nests them, but copy explicitly so the image is correct
# regardless of the host shell that ran the build).
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
USER nextjs
EXPOSE 8080
# Runtime env arrives as a Secret Manager volume mounted at /secrets/env (one
# dotenv file per service — see gcloud run deploy --set-secrets). Sourcing it
# here is deterministic for every var, with no reliance on Next's .env loading.
# Values were audited $-free; `exec` keeps node as PID 1 for signals.
CMD ["sh", "-c", "set -a; [ -f /secrets/env ] && . /secrets/env; set +a; exec node server.js"]
