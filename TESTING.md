# Testing eno.vn

A layered suite built on the standard test pyramid: a wide base of fast, deterministic unit
tests; black-box probes that verify a real deploy end-to-end; and an opt-in E2E/integration
layer above. The goal is **high signal, low flake** — every check here is deterministic or
retried, so a red result means a real regression.

```
            ▲  fewer, slower, higher-confidence
   ┌────────────────┐
   │  E2E (opt-in)  │   Playwright guest+seller flows           ← not yet wired (see below)
   ├────────────────┤
   │  live probes   │   smoke · seo · content · security        ← `npm run verify`
   ├────────────────┤
   │ integration    │   route handlers vs a test DB             ← opt-in (see below)
   ├────────────────┤
   │   unit (vitest)│   pure security/correctness logic         ← `npm test`
   └────────────────┘
            ▼  many, fast, deterministic
```

## Run it

| Command | What it does | Needs a deploy? |
|---|---|---|
| `npm test` | Unit tests (vitest), pure logic | no |
| `npm run verify:offline` | Unit + `tsc --noEmit` | no |
| `npm run verify` | Unit + typecheck + all live probes vs **https://eno.vn** | yes |
| `npm run verify http://localhost:3000` | …against a local/preview deploy | yes |
| `npm run smoke` / `seo:check` / `content:check` / `sec:probe` | One live probe (takes an optional base URL) | yes |

All live probes accept `[baseUrl]` (or `PROBE_BASE=…`) and exit non-zero on failure, so they
drop straight into CI or a post-deploy gate. They are **non-destructive**: GET-only or
deliberately-failing-auth calls — they never create data or touch a real account.

## Layer 1 — Unit (`src/**/*.test.ts`, vitest)

Pure, security- and correctness-critical logic, no DB/Next runtime:

- **`lib/api/oauth.test.ts`** — JWT issue/verify roundtrip, expiry boundary, and **forgery
  rejection** (wrong key, `alg:none`, tampered payload). The whole Partner-API token auth
  rests on this.
- **`lib/publish-guard.test.ts`** — the listing publish gate: banned illegal-content words
  (with word-boundary so *Samsung* ≠ *súng*), off-platform contact detection (email/link/
  handle/house-number, with *phố* ≠ *phở*), and `assertPublishable` priority order. Pins both
  false-negatives (bad listings slipping through) and false-positives (legit sellers blocked).
- **`lib/{phone,url,fold,slug,vnd}.test.ts`** — phone-in-text detection, open-redirect guard
  (`safeNextPath`), accent folding, slugging, VND money formatting.

`server-only` modules are unit-tested via a vitest alias (`vitest.config.ts`) that stubs the
import; the OAuth signing secret is set to a deterministic test value there.

## Layer 2 — Live probes (`scripts/*.mjs`)

Black-box checks against a deployed site — the most reliable layer given there's no test DB:

- **`smoke.mjs`** — every critical route 200s under a latency budget, no 5xx, a bogus path
  404s, sitemap/manifest/OpenAPI parse, baseline security headers present.
- **`seo-check.mjs`** — homepage head tags (title/description/canonical/OG/Twitter/`lang`),
  Organization/WebSite JSON-LD, a real listing's **Product/Offer/Breadcrumb** schema, and that
  sampled sitemap URLs actually resolve.
- **`content-integrity.mjs`** — samples the live feed and verifies **every listing image is on
  an allowed (optimizable) host and actually fetches** (the broken-card guard), prices are
  finite & ≥ 0, and money renders formatted on the homepage.
- **`sec-probe.mjs`** — auth fails closed: OAuth token endpoint error paths, **forged-JWT
  rejection** on `/api/v1` + `/api/mcp`, session/admin gating on protected routes, and
  security headers.

## Not yet wired (opt-in next layer)

Deliberately deferred to keep the suite deterministic and dependency-light. Each is a clear
next step when the need arises:

- **E2E (Playwright)** — real browser flows: guest (search → category → listing → language/
  theme toggle) and authed seller (post wizard, dashboard, availability). Needs
  `@playwright/test` + a browser download and a seeded/test account. Highest end-user
  confidence; highest maintenance.
- **Integration (route handlers vs a test DB)** — exercise `/api/*` against an ephemeral
  Postgres (Supabase branch or testcontainer): ownership/scoping, idempotency replay, SSRF
  block on webhook URLs, rate-limit 429 — the authed paths the black-box probes can't reach
  without credentials.
- **a11y (axe) + Lighthouse budgets** — automate the WCAG-AA contrast / Lighthouse-score
  checks currently done by hand (PSI mobile ~98–100). Pairs naturally with the Playwright layer.
