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
# ⚠️ RESILIENT npm ci. The build box has recurring transient npm-registry network stalls that hang or
# abort `npm ci` and lose a whole deploy (three times, 2026-09-02/03). Raise per-fetch retries/timeouts
# AND retry the whole command up to 3× so a transient failure recovers inside the build. `npm ci` wipes
# node_modules and reinstalls, so re-running it is idempotent (postinstall prisma generate / ffmpeg
# download included).
RUN npm config set fetch-retries 5 fetch-retry-mintimeout 20000 fetch-retry-maxtimeout 120000 fetch-timeout 600000 \
 && (npm ci || (echo 'npm ci retry 1' && sleep 10 && npm ci) || (echo 'npm ci retry 2' && sleep 30 && npm ci))

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
# ⛔ THE MARKETPLACE IMAGE MUST NOT CARRY SERVICES ARTWORK, AND `public/` IS THE ONE PLACE THE
# EDITION SPLIT DOES NOT REACH. Every other mechanism in this repo keys off the bundler — a
# `.svc.` pageExtension fold, a resolveAlias stub — and none of them touch static files: `public/`
# is copied verbatim into BOTH images. So eno.forum's baked e-visa banner, which exists only to be
# rendered by the services edition, was still fetchable at https://eno.vn/banners/evisa-desktop.webp
# with "Vietnam e-Visa … Apply now" painted into it. Unlinked and unindexed, but the standing rule
# names SERVING as the failure, not linking, and a licensed sàn TMĐT serving visa marketing from its
# own origin is the exact thing the split exists to prevent. Two reviewers caught this; a
# `.next/static` grep cannot, because the file was never in a chunk.
#
# ⚠️ IT IS PRUNED HERE, INSIDE THE BUILDER STAGE, AND DELIBERATELY NOT IN `npm run build`. This
# filesystem is ephemeral; a developer's working tree is not. The same prune in package.json would
# DELETE these files from the repo the first time anyone ran `node scripts/preview.mjs vn`.
#
# ⚠️ The pattern is prefix-based (`evisa-*`), so new services artwork inherits the prune by being
# named for the surface it belongs to. Name a services asset anything else and it ships to eno.vn.
#
# ⚠️ `public/icons/services/` IS THE SAME RULE WITH A DIRECTORY INSTEAD OF A PREFIX (2026-08-28).
# The category tiles gained 3D artwork, including a Vietnam e-Visa icon and a Trip planner icon.
# A whole folder is the clearest form of "named for the surface it belongs to": anything a designer
# drops in there is pruned by being in there, with no filename convention to remember. The taxonomy
# artwork stays in `public/icons/categories/` and ships to both editions, which is correct — those
# are categories, not services.
RUN --mount=type=secret,id=buildenv \
    sh -c 'set -a; [ -f /run/secrets/buildenv ] && . /run/secrets/buildenv; set +a; npm run build; \
           if [ "$NEXT_PUBLIC_ENO_EDITION" = "marketplace" ]; then \
             rm -fv public/banners/evisa-* .next/standalone/public/banners/evisa-* 2>/dev/null || true; \
             rm -rfv public/icons/services .next/standalone/public/icons/services 2>/dev/null || true; \
           fi'

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

# ⚠️ sharp's NATIVE BINARIES COME FROM `npm ci`, NOT FROM THE FILE TRACER. This is the fix for the
# 2026-07-27 outage, and it is one line because the tracer was the whole problem: Next decides what
# lands in `.next/standalone/node_modules` by tracing from the BUILD HOST, and on 0.35.3 it stopped
# emitting the linux-x64 `@img/*` packages — so the image shipped a sharp with nothing to load.
# The deps stage already ran `npm ci` on this exact platform, so it holds precisely the right
# platform packages (npm filters optional deps by os/cpu). Copying them makes the runtime depend on
# what was INSTALLED rather than on what was guessed.
#
# Additive and idempotent: when the tracer does the right thing these files are identical, and when
# it does not they are the difference between a working image and a nine-hour outage. It must come
# AFTER the standalone COPY so it wins on overlap.
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/@img ./node_modules/@img

# ⚠️ THE GUARD THAT WOULD HAVE PREVENTED THE 2026-07-27 OUTAGE. sharp@0.35.3 shipped an image whose
# standalone bundle carried NO loadable native backend for linux-x64: `next build` was green, every
# local gate was green, and production returned 500 on /api/listings for nine hours — because
# lib/ai-moderation imports sharp at MODULE SCOPE, so a failed native load takes down every route
# that transitively imports it, GET included.
#
# ⚠️ IT HAS TO RUN HERE, IN THE RUNNER STAGE, NOT LOCALLY. Next traces the standalone bundle's
# node_modules from the BUILD HOST, so the only place the question "can this image load sharp?" has
# a meaningful answer is inside this image, on this platform. A `docker run` on an arm64 laptop
# would resolve the darwin/arm64 binaries and pass while the deployed linux-x64 image was broken —
# that verification is theatre. This line is the real one, and it converts a silent runtime outage
# into a failed build, which blocks the deploy and leaves the previous revision serving.
#
# ⚠️ AFTER `USER nextjs`, DELIBERATELY. As root the check passes on files the SERVER may not be able
# to read, since everything above arrives via COPY --chown=nextjs:nodejs — so a root-run guard would
# be exactly the false green this exists to prevent. It runs as the account that runs server.js.
#
# Both branches were verified before shipping: with sharp absent the one-liner exits 1 (require
# throws synchronously, and the rejection path exits 1 too); with it present it exits 0 and prints
# the version. It also EXERCISES libvips rather than just resolving the module, so a binary that
# loads but cannot decode still fails here.
USER nextjs
# ⚠️ NO `require('sharp/package.json')` HERE. The guard used to print the version that way and it
# broke the moment sharp 0.35 landed — 0.35's `exports` map does not expose ./package.json, so the
# CHECK ITSELF would have failed the build (ERR_PACKAGE_PATH_NOT_EXPORTED). A guard that fails for
# its own reasons is worse than no guard: it cries wolf on a healthy image. It reports the format of
# the bytes it produced instead, which is evidence libvips actually ran.
RUN node -e "const m=require('sharp'); const s=m.default??m; s({create:{width:1,height:1,channels:3,background:'#000'}}).png().toBuffer().then(b=>console.log('sharp OK — encoded',b.length,'bytes, PNG magic',b.subarray(1,4).toString()),e=>{console.error('SHARP BROKEN IN IMAGE:',e.message);process.exit(1)})"
EXPOSE 8080
# Runtime env arrives as a Secret Manager volume mounted at /secrets/env (one
# dotenv file per service — see gcloud run deploy --set-secrets). Sourcing it
# here is deterministic for every var, with no reliance on Next's .env loading.
# Values were audited $-free; `exec` keeps node as PID 1 for signals.
CMD ["sh", "-c", "set -a; [ -f /secrets/env ] && . /secrets/env; set +a; exec node server.js"]
