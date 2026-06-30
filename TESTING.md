# Testing eno.vn

A layered suite built on the standard test pyramid: a wide base of fast, deterministic unit
tests; black-box probes that verify a real deploy end-to-end; and an opt-in E2E/integration
layer above. The goal is **high signal, low flake** — every check here is deterministic or
retried, so a red result means a real regression.

```
            ▲  fewer, slower, higher-confidence
   ┌────────────────┐
   │   E2E (guest)  │   Playwright guest flows (real browser)    ← `npm run e2e` (live)
   │  E2E (authed)  │   seller/admin write-flows                 ← opt-in: E2E_AUTHED_BASE
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
| `npm run e2e` | Playwright guest flows (desktop + mobile Chromium) vs prod | yes |
| `npm run e2e:guest` / `e2e:ui` / `e2e:report` | Guest projects only / Playwright UI / open HTML report | yes |

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

## Layer 3 — E2E (Playwright, `e2e/`, `playwright.config.ts`)

Real-browser flows — the only layer that exercises hydration, client routing, the carousel,
search, language/theme persistence, and **renders images for real** (catches a broken card a
URL check can't). Two safe-by-default modes:

- **Guest (`e2e/guest/*.spec.ts`)** — runs against a real deploy (prod by default, `E2E_BASE`
  to override) on **desktop + mobile-viewport Chromium**. Read-only: no auth, no writes, can't
  corrupt data. Covers home, search→results, category→listing client routing, listing media +
  carousel + gated contact, the EN/VI language pipeline, dark-mode (System default + persisted,
  no FOUC), and an **axe WCAG2 A/AA** scan on the top pages. A shared fixture pre-seeds the
  privacy-preserving cookie-consent choice so the consent modal never blocks interaction.
- **Authed (`e2e/seller/*`, `e2e/admin/*`)** — seller dashboard + Developers panel and the
  admin moderation two-pane. **Opt-in and never against prod**: the projects only register when
  `E2E_AUTHED_BASE` points at a PREVIEW deploy backed by a seeded Supabase branch;
  `e2e/auth.setup.ts` signs the seeded users in via `@supabase/ssr` (correct-by-construction
  cookies, no creds in the repo). Absent that env they self-skip. These specs are
  non-destructive (open forms / assert render; never mint a key, register a webhook, or resolve
  a real report).

**a11y baseline (tracked debt):** the axe gate disables one rule — `nested-interactive` — which
fires because `ListingCard`'s root is `<div role="button">` with the heart / map / carousel
buttons nested inside. Fixing it is a card-architecture change (card-as-link pattern) and is a
**dedicated follow-up**; the rule is baselined (not hidden) so the gate still catches *new* a11y
regressions. The transient "Loading map…" contrast issue axe flagged was fixed (`text-slate-700`).

## Not yet wired (opt-in next layer)

- **Authed-write E2E infra** — a preview deploy + ephemeral Supabase branch + seeded
  individual/business/admin users, so the authed specs above actually run (post wizard, key/
  webhook lifecycle, report resolution).
- **Integration (route handlers vs a test DB)** — exercise `/api/*` against an ephemeral
  Postgres: ownership/scoping, idempotency replay, SSRF block on webhook URLs, rate-limit 429 —
  the authed paths the black-box probes can't reach without credentials.
- **Lighthouse budgets** — automate the PSI score/perf budgets currently checked by hand (mobile
  ~98–100). Pairs naturally with the Playwright layer.
