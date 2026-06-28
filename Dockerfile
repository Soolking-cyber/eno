# syntax=docker/dockerfile:1
# Production image for Cloud Run (Singapore). Builds the Next.js standalone server
# (next.config.ts emits `output: "standalone"` whenever VERCEL is unset) into a
# tiny non-root runtime that listens on $PORT. Prisma 7 has no Rust engine and the
# pg driver is pure JS, so no native binaries / OpenSSL gymnastics are needed.

# ---------- deps: install node_modules (incl. dev, needed to build) ----------
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# `npm ci` runs the postinstall `prisma generate`; the schema is needed for that.
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci

# ---------- builder: next build → .next/standalone ----------
FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* values are INLINED into the client bundle at build time, so they must
# be present here (pass with --build-arg). DATABASE_URL is only needed if any route is
# statically pre-rendered against the DB; it stays in this stage and never reaches the
# final image. None of these are baked into the runtime layer below.
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_GA_ID
ARG NEXT_PUBLIC_META_PIXEL_ID
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
ARG NEXT_PUBLIC_AI_ASSIST
ARG DATABASE_URL
ARG DIRECT_URL
RUN npm run build

# ---------- runner: minimal non-root server ----------
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Cloud Run injects PORT (default 8080) and expects the server bound to 0.0.0.0.
ENV PORT=8080
ENV HOSTNAME=0.0.0.0
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
# The standalone bundle is self-contained; static/ and public/ are copied alongside it
# (the build script already nests them, but copy explicitly so the image is correct
# regardless of the host shell that ran the build).
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
USER nextjs
EXPOSE 8080
CMD ["node", "server.js"]
