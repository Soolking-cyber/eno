# eno.forum

Deployable Next.js workspace for the eno.forum community, Vietnam itinerary builder, concierge entry points, and e-Visa assistant. It lives in the `Soolking-cyber/eno` monorepo while retaining its own dependencies, build, tests, environment variables, Vercel project, and browser domains.

> [!IMPORTANT]
> **Deployment ownership:** `Soolking-cyber/eno/apps/forum` is the prepared forum
> source of truth. During cutover, the existing `eno-forum` Vercel project must be
> re-pointed here with Root Directory `apps/forum`; the root `eno` project continues
> to deploy eno.vn. Archive `Soolking-cyber/eno-forum` only after production checks
> pass, then keep it as read-only migration history.

## Hackathon submission

- **Code repository:** [github.com/Soolking-cyber/eno/tree/main/apps/forum](https://github.com/Soolking-cyber/eno/tree/main/apps/forum)
- **Live application:** [www.eno.forum](https://www.eno.forum)
- **Primary Codex `/feedback` session:** `019f68b8-0579-72d1-8d47-83bf3ac34fb5`

eno.forum is a travel-focused community product that brings together a public
forum, a research-grounded Vietnam itinerary builder with Word export and
concierge handoff, and a guided Vietnam e-Visa assistance workflow. The apps
share one account and dashboard, work across 11 interface languages, and link
travelers to the wider eno marketplace when they need local services.

### How Codex and GPT-5.6 were used

Codex running GPT-5.6 was the development collaborator for the majority of this
project. The product owner supplied the requirements, screenshots, service
configuration, and release decisions; Codex translated that direction into
implementation, inspected the resulting UI and behavior, and iterated from the
owner's feedback.

Codex and GPT-5.6 helped to:

- define and preserve the monorepo directory, authentication, data, and two
  Vercel deployment boundaries between `eno.forum` and `eno.vn`;
- implement and refine the forum, itinerary builder, DOCX export, e-Visa user
  flow and operator dashboard, shared navigation, localization, and responsive
  interactions;
- diagnose OAuth redirects, image-processing retry loops, provider rate limits,
  responsive date overlap, uneven controls, feed layout shifts, and malformed
  Word output using source inspection, logs, screenshots, and focused tests;
- improve safety and reliability with server-only credentials, bounded AI
  retries, private document access, explicit human review, and clear operator
  handoffs before government submission or payment; and
- validate changes with TypeScript, ESLint, production builds, Playwright tests
  on desktop and mobile, visual checks, Git diff review, and monitored GitHub /
  Vercel releases when authorized by the owner.

AI-generated changes were reviewed in the working tree and tested before being
accepted or deployed. Codex and GPT-5.6 were used for **development**, not as a
hidden runtime dependency: production itinerary, document-reading, and
translation requests use the configured Gemini models documented below.

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

Connect the existing `eno-forum` Vercel project to `Soolking-cyber/eno` with these settings:

- Root Directory: `apps/forum`
- Framework Preset: Next.js
- Build Command: `npm run build`
- Install Command: `npm install`
- Node.js: 24.x

The forum and marketplace projects connect to the same repository but retain independent domains, environment variables, build roots, and deployment histories. Pushes to `main` create production deployments for the affected project; pull requests and non-production branches create previews.

Set these production environment variables:

```text
NEXT_PUBLIC_FORUM_URL=https://www.eno.forum
NEXT_PUBLIC_MARKETPLACE_URL=https://eno.vn
MARKETPLACE_API_URL=https://eno.vn
APPLE_TEAM_ID=<Apple Developer team ID used by the eno iOS target>
APPLE_BUNDLE_ID=com.mk1e3.enovn
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<same publishable key as eno.vn>
SUPABASE_SECRET_KEY=<server-only key used by protected forum and visa routes>
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

The forum is also prepared to run as a first-party surface inside the single eno
iOS/Android application. The monorepo root owns the Capacitor, Xcode, and Android
projects; `apps/forum` intentionally contains no second native app.
The required release sequence, verified-link setup, secure cross-origin session
handoff, and native test matrix are documented in
[`docs/UNIFIED_MOBILE_APP.md`](docs/UNIFIED_MOBILE_APP.md).
The Vercel re-point, scoped-build checks, rollback, and repository archive sequence
are documented in [`docs/MONOREPO_CUTOVER.md`](docs/MONOREPO_CUTOVER.md).

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

The shared marketplace migration lives at `../../supabase/migrations/20260715090000_unified_forum_itinerary.sql`. It is additive, reuses `Profile`, enables RLS on every new table, and keeps public Data API access deny-by-default. Forum image uploads use the `forum-media` bucket with owner-folder write policies.

The e-Visa application, admin UI, and server routes live entirely in this workspace. Its forum-owned database migration is `supabase/migrations/20260716150000_visa_assistance.sql`; deployment and safety workflow are documented in `docs/VISA_ASSISTANCE.md`.
