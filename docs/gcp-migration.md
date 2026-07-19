# Vercel → Google Cloud Run migration (2026-07-19)

Owner decision: host both apps in the **support@eno.forum** Google account,
project `speedy-victory-500106-h8` (same project as Vertex AI — the app's Gemini
calls already bill here), region **asia-southeast1** (Singapore — same region as
the Supabase project `xihiryllwmjoouipkyhw`, ap-southeast-1). Cloudflare in
front for CDN/WAF/DNS. Vercel stays warm until the cutover is verified, then is
decommissioned.

## Target architecture

```
user → Cloudflare (DNS, proxy, WAF, static caching)
     → Google global external Application Load Balancer
         host eno.vn / www.eno.vn      → serverless NEG → Cloud Run: eno-vn
         host eno.forum / www.eno.forum → serverless NEG → Cloud Run: eno-forum
     → Supabase (unchanged) · Upstash (unchanged) · Vertex AI (same project)
```

- **Two services, two images** (`asia-southeast1-docker.pkg.dev/…/eno/eno-vn`,
  `…/eno/eno-forum`), built by Cloud Build from the repo's Dockerfiles
  (`Dockerfile`, `apps/forum/Dockerfile`; configs `cloudbuild.yaml` ×2).
- Base images are **debian-slim, not alpine**: ffmpeg-static (video transcode)
  ships a glibc binary.
- **Build-time env** (NEXT_PUBLIC_* inlining + the two ISR pages that query the
  DB at build) comes from Secret Manager (`eno-root-env` / `eno-forum-env`)
  through a BuildKit secret mount — never lands in image layers.
- **Runtime env**: the same dotenv secrets mounted at `/secrets/env`; the image
  CMD sources the file then `exec node server.js`. One secret per service; add a
  new secret VERSION + redeploy to rotate. (Values audited free of `$`/backtick
  so shell-sourcing is safe — keep it that way or switch the CMD to a node
  loader.)
- Runtime service account: `eno-run@…` (per-secret accessor only).

## Non-negotiable service flags (from the code sweep)

| Flag | eno-vn | eno-forum | Why |
|---|---|---|---|
| CPU allocation | **always** | **always** | `after()` does real work (webhooks, push, reindex, storage purge) after the response; request-scoped CPU throttles it to ~0 and silently drops it. |
| max-instances | **1 (for now)** | 3 | ISR uses the default per-instance filesystem cache; `revalidatePath` purges only the serving instance. A sold/moderated listing page (30d revalidate) must not survive on a sibling instance. Lift after a Redis `cacheHandler` (Upstash) ships. Forum has zero ISR — safe to scale. |
| min-instances | 1 | 0 | Kills cold starts on the marketplace + keeps `after()` work alive; forum can scale to zero. |
| memory / CPU | 2Gi / 2 | 1Gi / 1 | Transcode route needs 2GB (was vercel.json `memory: 2048`). |
| timeout | 320s | 120s | Transcode internal wall is 210s; warm-translations 300s. |
| concurrency | 80 | 80 | Node async I/O default; tune with load data. |
| ingress | all → later `internal-and-cloud-load-balancing` | same | Locked down once the LB is up, so `cf-connecting-ip` can't be spoofed by direct-origin hits. |

## Cron jobs (Cloud Scheduler, UTC — replaces vercel.json crons)

All GET with header `Authorization: Bearer $CRON_SECRET` (per-service value from
its env secret). Attempt deadline 320s for warm-translations, 180s otherwise.

| Job | Path (service) | Schedule |
|---|---|---|
| daily-reminders | /api/cron/daily-reminders (eno-vn) | 0 2 * * * |
| saved-search-alerts | /api/cron/saved-search-alerts (eno-vn) | 0 5 * * * |
| warm-translations | /api/cron/warm-translations (eno-vn) | 0 21 * * * |
| weekly-digest | /api/cron/weekly-digest (eno-vn) | 0 2 * * 4 |
| price-stats | /api/cron/price-stats (eno-vn) | 0 3 * * * |
| video-gc | /api/cron/video-gc (eno-vn) | 30 3 * * * |
| visa-retention | /api/cron/visa-retention (eno-forum) | 0 19 * * * |

## Known issues to resolve before/at cutover

1. **Video transcode vs Cloudflare's ~100s proxy timeout.** The synchronous
   `/api/upload/video/transcode` call can run to 210s; behind the orange cloud
   it dies at ~100s. Fix: convert to submit-then-poll (202 + status route,
   transcode continues under CPU-always). Planned as migration phase 2 code
   work. Until then video posting would break behind Cloudflare — do not cut
   DNS before this lands (or temporarily grey-cloud the apex).
2. **Image upload batches vs the 32MB HTTP/1 request cap** (declared max 8×12MB;
   real client batches are compressed and far smaller). Verify the wizard's
   actual payloads; if needed, chunk client-side.
3. **ISR scale-out**: single-instance pin until a Redis cacheHandler lands.
4. Cosmetic: `kb-debug.tsx` build tag read `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA`
   (Vercel-injected) — shows `dev` on Cloud Run until pointed at a build arg.

## Cutover plan (zero-downtime, rollback = DNS)

1. ✅ Recover env from both Vercel projects → `~/eno-gcp-migration/env/` +
   Secret Manager (`eno-root-env` v1, `eno-forum-env` v1).
2. ✅ Dockerfiles (slim + BuildKit secrets + non-root + env-sourcing CMD),
   `.dockerignore`s, `cloudbuild.yaml` ×2; forum gains guarded
   `output: standalone`; Artifact Registry repo `eno`; `eno-run` SA + grants;
   APIs enabled (run, cloudbuild, artifactregistry, secretmanager, scheduler).
3. ✅ Code fixes: forum clientIp helpers read `cf-connecting-ip` first;
   otp-channel uses the shared helper; Vercel telemetry SDKs removed (CSP
   entry dropped).
4. ⏳ Cloud Build both images → deploy services `eno-vn` + `eno-forum` on
   run.app URLs with the flags above.
5. Verify on run.app: guest e2e suite (`E2E_BASE=<run.app url>`), transcode
   probe, cron probes (`curl -H "Authorization: Bearer …" /api/cron/price-stats`
   style — read-only ones), header/CSP parity, image optimizer, DB latency.
6. Create the 7 Scheduler jobs; PAUSED until cutover (avoid double-firing next
   to Vercel's crons); delete the crons from vercel.json at cutover.
7. Transcode submit-then-poll refactor (known issue 1) + re-verify.
8. **Owner actions**: create/confirm the Cloudflare account; add sites eno.vn +
   eno.forum; at the registrars, switch nameservers to Cloudflare. (I: import
   current DNS records first — Vercel A/CNAME initially, so nothing changes.)
9. Build the LB: two serverless NEGs, URL map by host, certs via Certificate
   Manager DNS authorization (one CNAME each, works while proxied) or a
   Cloudflare Origin CA cert; Cloudflare SSL mode Full (strict).
10. Cutover per domain (forum first — lower risk, no ISR, no payments): flip
    the Cloudflare DNS records from Vercel to the LB IP, orange-cloud on.
    Watch logs + error rates. eno.vn follows after a soak.
11. Post-cutover: restrict Cloud Run ingress to the LB; unpause Scheduler;
    Cloudflare cache rules for `/_next/static/*` (immutable) + `/_next/image`
    (respect origin TTL); prod guest e2e against the domains; update OAuth
    redirect allowlists ONLY if any pointed at *.vercel.app (they use the
    domains — verify); Capacitor apps keep working (they load the domains).
12. Soak 48h → remove Vercel projects (domains released), delete vercel.json
    crons block, update `/ship` skill to build+deploy Cloud Run instead of
    polling Vercel, set up a Cloud Build GitHub trigger (owner OAuth) for
    push-to-deploy parity.

**Rollback at any point before step 12**: point Cloudflare DNS back at Vercel
(records preserved by the import in step 8) — Vercel deployment stays live and
current until decommission.

## Cost notes

- eno-vn: 1 always-on 2Gi/2cpu instance ≈ mid-double-digit $/mo (instance
  billing), well under Vercel Pro + function overages at equivalent traffic;
  scale ceiling raised by the Redis cacheHandler when needed, not by paying
  per-invocation.
- eno-forum: scale-to-zero, near-zero idle cost.
- LB ≈ $18/mo + egress (mostly absorbed by Cloudflare caching).
