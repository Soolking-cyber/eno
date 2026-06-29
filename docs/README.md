# eno.vn — Documentation

Engineering + integration docs for **eno.vn**, a verified marketplace for Vietnamese expats (Next.js 16 App Router · Prisma 7 · Supabase Postgres · Vercel + Cloudflare).

## Core

| Doc | What it covers |
|---|---|
| [**ARCHITECTURE.md**](./ARCHITECTURE.md) | The whole platform — stack & runtime, data model, auth, listings, search/ranking, trust, messaging, AI, dashboard/bulk, growth/feeds, and ops/security — with `file:line` citations. Start here. |
| [**API-REFERENCE.md**](./API-REFERENCE.md) | Every `/api/*` route (59) inventoried: method, auth class, rate-limit, request/response, purpose. Grouped by domain with an auth legend. |
| [**PARTNER-API-ROADMAP.md**](./PARTNER-API-ROADMAP.md) | The path to **programmatic shop management** — for partners' own systems and for AI agents. Per-shop auth (API keys / OAuth2), a versioned `/api/v1`, quotas/idempotency/webhooks, an **MCP server** so AI agents manage shops in natural language, and a phased build plan (reuse-existing vs build-new). |

## Operational runbooks

| Doc | What it covers |
|---|---|
| [hosting-migration.md](./hosting-migration.md) | Hosting / infra migration notes. |
| [vertex-search-setup.md](./vertex-search-setup.md) | Vertex AI Search (the AI concierge / semantic search backend) setup. |

## Conventions

- **Schema changes** use `prisma db push` (no migrations dir) — see the schema-change flow in [ARCHITECTURE.md → Ops](./ARCHITECTURE.md#ops-security-deploy).
- **Security posture:** RLS is bypassed by design; **app code is the only access guard**. Paid/PII routes fail *closed* on a Redis outage; the `/api/*` surface is edge-pinned behind Cloudflare.
- **Docs are generated from the code** via the `eno-docs-and-api-path` workflow — regenerate after large changes rather than hand-editing the big three above.
