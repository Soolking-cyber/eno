# Hosting migration: Vercel → Cloudflare + Cloud Run (Singapore) + Supabase

Target architecture (decided 2026-06-28):

```
            Vietnam users
                 │  <15ms on cache hits
        ┌────────▼─────────┐
        │   Cloudflare     │  CDN + WAF. Caches feed/rails/SEO HTML + assets at the
        │  (already in     │  VN edge. Only cache-MISSES + dynamic POST/auth/writes
        │   front today)   │  fall through to origin.
        └────────┬─────────┘
                 │ misses only
        ┌────────▼─────────┐
        │   Cloud Run      │  Next.js standalone container, region asia-southeast1
        │  asia-southeast1 │  (Singapore). Autoscales; scales toward 0 at 3am ICT.
        └────────┬─────────┘
                 │ pooled (6543, transaction mode)
        ┌────────▼─────────┐
        │  Supabase PG     │  AWS ap-southeast-1 (Singapore) — same region as compute.
        │  (Supavisor)     │  Transaction pooler so containers don't exhaust conns.
        └──────────────────┘
```

## What's already done in the repo (no action)

- **Standalone output** — `next.config.ts` emits `output: "standalone"` whenever `VERCEL` is unset; `Dockerfile` builds it. (On Vercel it stays off so Edge middleware doesn't crash.)
- **Transaction pooler** — `src/lib/db.ts` already talks to Postgres through `@prisma/adapter-pg` against the **pooled** `DATABASE_URL` (Supavisor, port 6543, transaction mode), with a global singleton so we don't exhaust connections. DDL/migrations use `DIRECT_URL` via `prisma.config.ts`. **This is exactly the data-layer plan — nothing to change.**
- **Edge cache headers** — the feed (`/api/listings`), price histogram, category rails and businesses rail send `Cache-Control` with `s-maxage` + `stale-while-revalidate`, so Cloudflare can serve them from the VN edge.
- **Cron routes** — `/api/cron/daily-reminders` and `/api/cron/saved-search-alerts` exist and are guarded by a `CRON_SECRET` bearer. We just re-point them from `vercel.json` to Cloud Scheduler.

## Phase 0: run Vercel + Cloud Run in parallel, cut over at launch

Both run off the **same commit** (the `VERCEL ? undefined : "standalone"` toggle picks
the right output per platform) against the **same Supabase + Upstash** — they're stateless
app servers, so this is just "more instances of the app." Each keeps its own connection
pool; the transaction pooler is built for that. Rules for the parallel window:

- **GCP on a staging hostname, not the live domain.** Keep `eno.vn` on Vercel; expose
  Cloud Run at its `*.run.app` URL or `staging.eno.vn` (proxied). Validate against real
  infra without touching real users. Set `NEXT_PUBLIC_APP_URL`/`BASE_URL` to the staging
  host on the GCP deploy.
- **⚠️ Crons must be single-homed.** The cron routes send notifications + mutate state, so
  running them on *both* platforms double-sends. **Keep crons on Vercel only — do NOT
  create the Cloud Scheduler jobs (§4) until cutover.** Cloud Run never self-triggers them.
- **Don't split real users across both** for the same domain — independent ISR/CF caches +
  server-side Meta CAPI mean split traffic risks stale-cache divergence and double-counted
  conversions. Keep live users on Vercel; flip wholesale at launch.
- **Cost:** Cloud Run `min-instances=1` ≈ $10–30/mo + usage; Vercel unchanged.

**Launch = a DNS flip:** point the proxied `eno.vn` record Vercel → Cloud Run, create the
Scheduler jobs (§4), delete the `vercel.json` crons. Rollback = flip the record back (keep
Vercel up a few days). See §7 for the full cutover checklist.

## 0. Prerequisite: confirm Supabase region

Dashboard → Project → Settings → General → Region. It **must be** `ap-southeast-1 (Singapore)` to sit next to Cloud Run. If it's elsewhere, moving regions = create a new Singapore project and `pg_dump`/`pg_restore` the data (the connection strings change). Do this first — everything else assumes the project is in Singapore.

Grab two connection strings (Settings → Database):
- **Pooled / transaction** (port **6543**, `...pooler.supabase.com`) → `DATABASE_URL`
- **Direct** (port **5432**) → `DIRECT_URL` (migrations only)

## 1. One-time GCP setup

```bash
PROJECT=eno-vn            # your GCP project (already used for Vertex/Gemini)
REGION=asia-southeast1
REPO=eno

gcloud config set project $PROJECT
gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
  cloudscheduler.googleapis.com secretmanager.googleapis.com
gcloud artifacts repositories create $REPO \
  --repository-format=docker --location=$REGION
gcloud auth configure-docker $REGION-docker.pkg.dev
```

## 2. Environment variables

`NEXT_PUBLIC_*` are **inlined into the client bundle at build time** → they must be passed
as `--build-arg` when building the image. Everything else is **runtime** and goes on the
Cloud Run service (secrets via Secret Manager).

**Build-time (`--build-arg`, 7):**
`NEXT_PUBLIC_APP_URL` · `NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` ·
`NEXT_PUBLIC_GA_ID` · `NEXT_PUBLIC_META_PIXEL_ID` · `NEXT_PUBLIC_VAPID_PUBLIC_KEY` ·
`NEXT_PUBLIC_AI_ASSIST`  (+ `DATABASE_URL`/`DIRECT_URL` only if a route is statically
pre-rendered against the DB; they stay in the builder stage, never in the final image.)

**Runtime — secrets** (Secret Manager → `--set-secrets`):
`DATABASE_URL` · `DIRECT_URL` · `SUPABASE_SECRET_KEY` · `CRON_SECRET` · `CONTACT_IP_SALT` ·
`UPSTASH_REDIS_REST_URL` · `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_URL`/`KV_REST_API_TOKEN`) ·
`GOOGLE_MAPS_API_KEY` · `GOOGLE_TRANSLATE_API_KEY` · `GOOGLE_VERTEX_CREDENTIALS` ·
`AZURE_TRANSLATOR_KEY` · `META_CAPI_TOKEN` · `TELEGRAM_BOT_TOKEN` · `FB_PAGE_TOKEN` ·
`VAPID_PRIVATE_KEY` · `FEED_PASSWORD` · `ESMS_*` / `SPEEDSMS_TOKEN` / `SEND_SMS_HOOK_SECRET` (whichever SMS provider is live).

**Runtime — non-secret** (`--set-env-vars`):
`NODE_ENV=production` · `BASE_URL` · `ADMIN_EMAILS` · `GOOGLE_VERTEX_PROJECT` ·
`GOOGLE_VERTEX_LOCATION` · `AZURE_TRANSLATOR_ENDPOINT` · `AZURE_TRANSLATOR_REGION` ·
`META_PIXEL_ID` · `FB_PAGE_ID` · `TELEGRAM_CHAT_ID` · `FEED_USER` · `VAPID_SUBJECT` ·
`CATALOG_EXCLUDE_MOCK` · `ESMS_OAID` / `ESMS_SMS_BRANDNAME` / `ESMS_ZNS_OTP_TEMPLATE`.

> Do **not** set `VERCEL` on Cloud Run — leaving it unset is what enables standalone output.

Create the secrets once (repeat per secret):
```bash
printf '%s' 'THE_VALUE' | gcloud secrets create DATABASE_URL --data-file=-
# update later: printf '%s' 'NEW' | gcloud secrets versions add DATABASE_URL --data-file=-
```

## 3. Build, push, deploy

```bash
TAG=$REGION-docker.pkg.dev/$PROJECT/$REPO/web:$(git rev-parse --short HEAD)

docker build \
  --build-arg NEXT_PUBLIC_APP_URL="https://eno.vn" \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="https://<ref>.supabase.co" \
  --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="sb_publishable_..." \
  --build-arg NEXT_PUBLIC_GA_ID="G-..." \
  --build-arg NEXT_PUBLIC_META_PIXEL_ID="..." \
  --build-arg NEXT_PUBLIC_VAPID_PUBLIC_KEY="B..." \
  --build-arg NEXT_PUBLIC_AI_ASSIST="1" \
  --build-arg DATABASE_URL="postgres://...:6543/postgres" \
  -t $TAG .
docker push $TAG

gcloud run deploy eno-web \
  --image=$TAG --region=$REGION --platform=managed --allow-unauthenticated \
  --port=8080 --cpu=1 --memory=1Gi --concurrency=80 \
  --min-instances=1 --max-instances=20 \
  --set-env-vars="NODE_ENV=production,BASE_URL=https://eno.vn,ADMIN_EMAILS=...,..." \
  --set-secrets="DATABASE_URL=DATABASE_URL:latest,DIRECT_URL=DIRECT_URL:latest,CRON_SECRET=CRON_SECRET:latest,UPSTASH_REDIS_REST_URL=UPSTASH_REDIS_REST_URL:latest,UPSTASH_REDIS_REST_TOKEN=UPSTASH_REDIS_REST_TOKEN:latest,..."
```

- `--min-instances=1` keeps one warm instance so there are no cold starts on the Node server. Set `0` for maximum 3am-ICT savings at the cost of an occasional cold start.
- `--concurrency=80` lets a single instance serve many simultaneous requests (Next is async); raise if CPU stays low under load.

> A scripted `scripts/deploy-cloudrun.sh` that sources `.env.production` for the build-args
> is the obvious next step once the values are settled — say the word and I'll add it.

## 4. Crons → Cloud Scheduler (replaces `vercel.json`)

```bash
URL=https://eno.vn   # or the Cloud Run URL during testing
gcloud scheduler jobs create http eno-daily-reminders \
  --location=$REGION --schedule="0 2 * * *" --time-zone="Asia/Ho_Chi_Minh" \
  --uri="$URL/api/cron/daily-reminders" \
  --http-method=GET --headers="Authorization=Bearer THE_CRON_SECRET"
gcloud scheduler jobs create http eno-saved-search-alerts \
  --location=$REGION --schedule="0 5 * * *" --time-zone="Asia/Ho_Chi_Minh" \
  --uri="$URL/api/cron/saved-search-alerts" \
  --http-method=GET --headers="Authorization=Bearer THE_CRON_SECRET"
```
(Vercel crons are UTC; Cloud Scheduler lets us pin `Asia/Ho_Chi_Minh` directly.) Once live,
delete the `crons` block from `vercel.json`.

## 5. Cloudflare

DNS: point `eno.vn` / `www` at the Cloud Run URL (CNAME to the run.app host, or a Cloud Run
custom domain), **proxied (orange cloud)**. Keep the existing `cf-connecting-ip` handling —
`src/lib/client-ip.ts` already reads it first, so rate-limit keying stays correct.

**Cache Rules** (Rules → Cache Rules), in order:

1. **Bypass** when logged in or mutating — match `http.request.method ne "GET"` **or**
   `http.cookie contains "sb-"` (Supabase auth cookie) **or** path starts with
   `/dashboard` `/account` `/api/conversations` `/api/me` `/api/notifications` `/api/upload`
   → **Bypass cache**. This guarantees no personalized response is ever edge-cached.
2. **Cache** the public read surfaces — path matches `/api/listings*` `/api/category-rails*`
   `/api/businesses/top*` `/c/*` `/listings/*` `/brands*` or the home page, and the request
   is a GET with no auth cookie → **Eligible for cache**, **Edge TTL: respect origin**
   (uses the `s-maxage` we send), **Browser TTL: respect origin**.
3. `/_next/static/*`, `/logo.svg`, fonts, images → cached by default (immutable hashes).

Set the cache key to **include the query string** (default) so each filter/sort/location
combination caches separately.

## 6. Cache invalidation across instances (important)

Mutation routes call `revalidatePath('/listings/<id>')`. With one CDN in front of many
autoscaled instances, that purges only the instance that handled the write **and** leaves
Cloudflare holding the old page until its TTL. Two-part fix:

- **Origin:** the listing detail page is ISR and self-heals on its `revalidate` timer, so
  other instances converge within the window even today.
- **Edge:** add a Cloudflare purge-by-URL on the same mutations (edit / mark-sold / hide).
  One small helper (`POST .../zones/{zone}/purge_cache` with `{files:["https://eno.vn/listings/<id>"]}`,
  fire-and-forget in `after()`) makes sold/edited listings update instantly at the edge.
  **Recommended add — ping me to wire it** alongside the existing `revalidatePath` calls.

A shared Next cache handler (Redis-backed) is the heavier alternative; with Cloudflare as the
single front cache + ISR self-heal + per-URL purge, it's optional for launch.

## 7. Cutover & rollback

1. Deploy to Cloud Run, hit the `*.run.app` URL directly → smoke test (browse, search,
   post, sign-in, a cron with the secret).
2. Load test the feed against the run.app URL (e.g. `k6`/`vegeta`, ramp to expected peak)
   — watch Cloud Run CPU + Supabase pooler connections.
3. In Cloudflare, move the proxied DNS record from Vercel to Cloud Run. TTL low first.
4. Watch CF analytics (cache hit ratio should be high on feed/SEO) + Cloud Run logs.
5. **Rollback** = point the CF record back at Vercel (keep the Vercel project up for a few
   days). DNS-only change, instant.

## 8. Verify

- [ ] Supabase project in `ap-southeast-1`; pooled `DATABASE_URL` on 6543.
- [ ] `docker build` succeeds with all 7 `NEXT_PUBLIC_*` build-args; image runs locally on `:8080`.
- [ ] Cloud Run healthy in `asia-southeast1`; both Scheduler jobs return 200 with the secret.
- [ ] CF cache HIT on `/api/listings` + listing pages; BYPASS when the `sb-` cookie is present.
- [ ] Rate limiting still keys on `cf-connecting-ip` (burst test a geocode route → 429s).
- [ ] `vercel.json` crons removed once Scheduler is confirmed.
