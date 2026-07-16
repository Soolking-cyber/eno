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
NEXT_PUBLIC_TURNSTILE_SITE_KEY=<same public site key as eno.vn>
GEMINI_API_KEY=<server-only Gemini API key>
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

The forum uses the marketplace Supabase Auth project, so both apps resolve to the same `auth.users.id` and public `Profile`. Each domain keeps its own secure auth cookie because `.vn` and `.forum` cannot share cookies. The forum owns the Gemini itinerary generation route and keeps `GEMINI_API_KEY` server-only; itinerary saves and all marketplace database access continue through the same-origin `/api/backend/*` proxy to eno.vn. Prisma and database credentials remain only in the marketplace backend. This also keeps Vercel preview URLs compatible with the marketplace's strict browser CORS policy.

The database migration remains in the private eno.vn marketplace repository at `supabase/migrations/20260715090000_unified_forum_itinerary.sql`. It is additive, reuses `Profile`, enables RLS on every new table, and keeps public Data API access deny-by-default. Forum image uploads use the `forum-media` bucket with owner-folder write policies.
