# eno.forum

Independent Next.js application for the eno.forum community experience and Vietnam itinerary builder. It has its own Git repository, dependencies, build, tests, environment variables, and Vercel project while sharing identity and backend data with eno.vn.

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

Set these production environment variables:

```text
NEXT_PUBLIC_FORUM_URL=https://eno.forum
NEXT_PUBLIC_MARKETPLACE_URL=https://eno.vn
MARKETPLACE_API_URL=https://eno.vn
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<same publishable key as eno.vn>
NEXT_PUBLIC_TURNSTILE_SITE_KEY=<same public site key as eno.vn>
```

Add the custom domain to this forum project in Vercel. In the marketplace Vercel project, set `NEXT_PUBLIC_FORUM_URL=https://eno.forum` and redeploy. `FORUM_DEV_ORIGINS` is optional and should contain only comma-separated local forum origins used for local production-mode testing.

In Supabase Authentication → URL Configuration, add these redirect URLs:

```text
https://eno.forum/auth/callback
http://localhost:3101/auth/callback
http://127.0.0.1:3101/auth/callback
```

Also add `eno.forum` to the allowed hostnames for the existing Cloudflare Turnstile widget. Email magic-link sends use the same invisible bot check as the marketplace; Google OAuth does not need it.

The forum uses the marketplace Supabase Auth project, so both apps resolve to the same `auth.users.id` and public `Profile`. Each domain keeps its own secure auth cookie because `.vn` and `.forum` cannot share cookies. The forum's same-origin `/api/backend/*` proxy forwards authorized requests to the centralized eno.vn `/api/forum/*` and `/api/itineraries/*` routes; Prisma and database credentials remain only in the marketplace backend. This also keeps Vercel preview URLs compatible with the marketplace's strict browser CORS policy.

The database migration remains in the private eno.vn marketplace repository at `supabase/migrations/20260715090000_unified_forum_itinerary.sql`. It is additive, reuses `Profile`, enables RLS on every new table, and keeps public Data API access deny-by-default. Forum image uploads use the `forum-media` bucket with owner-folder write policies.
