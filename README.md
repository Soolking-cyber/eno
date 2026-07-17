# eno.forum

Independent Next.js application for the eno.forum community experience and Vietnam itinerary builder. It has its own Git repository, dependencies, build, tests, environment variables, and Vercel project while sharing identity and backend data with eno.vn.

> [!IMPORTANT]
> **Deployment ownership:** forum and itinerary changes ship from this repository,
> `Soolking-cyber/eno-forum`, to the separate `eno-forum` Vercel project. The
> `apps/forum` directory in `Soolking-cyber/eno` is only a mirror; pushing that
> monorepo does not deploy `eno.forum`. Always port forum changes here, validate
> this repository, and push this repository's `main` branch.

## Local development

```bash
npm install
npm run dev
```

The forum runs at `http://localhost:3101`. The marketplace remains on port 3000.

## Design language

- Prioritize symmetry, visual balance, and a pleasant, uncluttered composition.
- Prefer airy outlined controls ("open borders") with clear but quiet borders, generous internal space, and consistent corner radii.
- Controls presented as a pair or group must share the same height, padding, alignment, and visual weight. Use equal widths when the actions are peers.
- Use a 44px control height for prominent form and action groups unless the surrounding component deliberately uses another shared size.
- Check both desktop and mobile layouts; responsive reflow must preserve the same visual hierarchy and symmetry.

## Vercel project

Import the `Soolking-cyber/eno-forum` repository into its dedicated Vercel project with these settings:

- Root Directory: `.`
- Framework Preset: Next.js
- Build Command: `npm run build`
- Install Command: `npm install`
- Node.js: 24.x

The Vercel project is connected to this repository. Pushes to `main` create production deployments, while pull requests and non-production branches create previews.

Set these production environment variables:

```text
NEXT_PUBLIC_FORUM_URL=https://www.eno.forum
NEXT_PUBLIC_MARKETPLACE_URL=https://eno.vn
MARKETPLACE_API_URL=https://eno.vn
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<same publishable key as eno.vn>
SUPABASE_SECRET_KEY=<server-only secret key used by the forum visa routes>
VISA_DATA_ENCRYPTION_KEY=<32 random bytes encoded as base64; server-only>
VISA_ADMIN_EMAILS=<optional comma-separated additional trained operator emails; support@eno.forum is built in>
BROWSERBASE_API_KEY=<server-only Browserbase API key>
BROWSERBASE_PROJECT_ID=<Browserbase project ID; optional when inferred from the API key>
BROWSERBASE_CONTEXT_ID=<private reusable context ID for official-site cookies/login state>
CRON_SECRET=<random server-only retention-cron secret>
NEXT_PUBLIC_TURNSTILE_SITE_KEY=<same public site key as eno.vn>
GEMINI_VERTEX_API_KEY=<server-only Vertex AI API key restricted to aiplatform.googleapis.com>
GEMINI_ITINERARY_MODEL=gemini-3.5-flash
GEMINI_ITINERARY_FALLBACK_MODEL=gemini-3.1-flash-lite
GEMINI_VISA_MODEL=gemini-3.1-flash-lite
GEMINI_VISA_FALLBACK_MODEL=gemini-3.5-flash
GEMINI_TRANSLATION_MODEL=gemini-3.1-flash-lite
UPSTASH_REDIS_REST_URL=<server-only Upstash REST URL>
UPSTASH_REDIS_REST_TOKEN=<server-only Upstash REST token>
```

The custom domain is attached to this forum project. The apex `https://eno.forum` redirects to the canonical `https://www.eno.forum`. In the marketplace Vercel project, set `NEXT_PUBLIC_FORUM_URL=https://eno.forum` and redeploy. `FORUM_DEV_ORIGINS` is optional and should contain only comma-separated local forum origins used for local production-mode testing.

In Supabase Authentication → URL Configuration, add these redirect URLs:

```text
https://eno.forum/auth/callback
https://www.eno.forum/auth/callback
https://*-eno-vn.vercel.app/**
http://localhost:3101/auth/callback
http://127.0.0.1:3101/auth/callback
```

Also add `eno.forum` to the allowed hostnames for the existing Cloudflare Turnstile widget; Cloudflare applies a root hostname entry to its subdomains, including `www`. Email magic-link sends use the same invisible bot check as the marketplace; Google OAuth does not need it.

The forum uses the marketplace Supabase Auth project, so both apps resolve to the same `auth.users.id` and public `Profile`. Each domain keeps its own secure auth cookie because `.vn` and `.forum` cannot share cookies. The forum owns the Gemini itinerary and visa-analysis routes and keeps `GEMINI_VERTEX_API_KEY` server-only; `GEMINI_API_KEY` remains an optional Gemini Developer API fallback. The production Vertex AI key belongs to the billed `eno-translate` Google Cloud project owned by `support@eno.forum` and must remain restricted to `aiplatform.googleapis.com`. Itinerary research uses stable Gemini 3.5 Flash; passport/portrait analysis and cached translation use the lower-cost Gemini 3.1 Flash-Lite, with one explicit 3.5 fallback for visa analysis. Every request disables the SDK's five-attempt default so paid retries stay bounded. A signed-in `support@eno.forum` admin can inspect the resolved non-secret configuration at `/api/admin/ai-health` and run a small live check at `/api/admin/ai-health?probe=1`.

After changing any Gemini environment variable, redeploy all Vercel environments that should receive it. Never put the API key in `NEXT_PUBLIC_*`, browser code, GitHub, logs, or support messages. The key name and model variables are safe to document; the key value is not.

Itinerary saves and all marketplace database access continue through the same-origin `/api/backend/*` proxy to eno.vn. Prisma and database credentials remain only in the marketplace backend. This also keeps Vercel preview URLs compatible with the marketplace's strict browser CORS policy.

The database migration remains in the private eno.vn marketplace repository at `supabase/migrations/20260715090000_unified_forum_itinerary.sql`. It is additive, reuses `Profile`, enables RLS on every new table, and keeps public Data API access deny-by-default. Forum image uploads use the `forum-media` bucket with owner-folder write policies.

The e-Visa assistance feature is different: its complete application and admin code lives in this standalone repository. Its forum-owned database migration is `supabase/migrations/20260716150000_visa_assistance.sql`; deployment and safety workflow are documented in `docs/VISA_ASSISTANCE.md`.
