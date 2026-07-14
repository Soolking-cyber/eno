# eno.vn — working agreement

Vietnamese expat marketplace. Next.js 16 (App Router) · Tailwind v4 · Prisma 7 → Supabase · Vercel. `PRELAUNCH=true` until the owner flips it.

## Model routing — top tier everywhere; delegate for isolation, not for savings

**Policy (owner, 2026-07-14): every worker runs on the highest-intelligence model.** No task on this repo gets a downgraded brain — the cost of a missed bug on a live marketplace dwarfs the cost of the tokens. Claude Code has **no automatic per-prompt router** (the main-loop model is whatever `/model` says and never changes on its own), so this is enforced the only way it can be: each agent and skill below pins `model:` explicitly, and that pin overrides the session.

**The dial is `effort:`, not `model:`.** Mechanical retrieval doesn't need deep reasoning; a race condition does. Same intelligence, different amount of thinking.

| Work | Send it to | Model / effort |
|---|---|---|
| "Where is X?", "every call site", "do we already have a helper?" | `scout` | Opus · low |
| UI diff → canon drift | `canon-reviewer` | Opus · high |
| Copy → bilingual contract | `i18n-reviewer` | Opus · high |
| **Independent second opinion / adversarial review** | `fable-reviewer` | **Fable 5 · xhigh** |
| A bug that already survived one plausible fix | `deep-debugger` | Opus · xhigh |
| Shipping to prod (the whole ritual) | `/ship` | Opus · medium |
| Seller/admin e2e suite | `/authed-e2e` | Opus · low |
| Design, architecture, anything genuinely novel | main thread | session model |

Three habits that follow:

- **Delegate search to `scout`.** Not to save money — to keep bulk grep output out of the main context. You get the conclusion, not the file dump.
- **Escalate, don't grind.** A fix that didn't hold goes to `deep-debugger` (Opus, xhigh), not to a second guess at the same altitude.
- **Break agreement bias with `fable-reviewer`.** It runs on a *different model family*, so it doesn't inherit our blind spots. When the main thread and its reviewers all agree, that's precisely when to ask the dissenter — especially on the money and trust paths (offers, publish gate, contact reveals, conversations). `/codex:review` is the same trick from a third family; use both on anything irreversible.

In a `Workflow`, pass `model` and `effort` per `agent()` call. Cross-family verification is the highest-value use of the option: find with one family, refute with another.

## Non-negotiables

- **Design canon** — `docs/design-language.md` is enforced by `scripts/design-lint.mjs` (runs in `npm run lint`, at the head of `npm run build`, and on every `.tsx` edit via a PostToolUse hook). Type scale, radius tiers, tokens-only color. `text-body` in markup is a **color** utility, not a size.
- **Primitives** — reuse `src/components/ui/*` and `<ListingCard>` / `<SellerCard>`. `<Button variant="cta">` is the one brand CTA. We're on Base UI: compose with the **`render` prop, not `asChild`** (our `ui/button` is the sole exception, bridging one to the other).
- **i18n** — every user-facing string via `tr(en, vi)` / `<Tr>`; regenerate `src/generated/ui-strings.ts` after adding copy (a hook does it); curated Vietnamese goes in `src/generated/vi-overrides.ts`. Admin chrome is EN-only by convention. English is a translation **target**, not just the source.
- **Money** — always through `src/lib/vnd.ts`; Vietnamese uses dots as thousands separators (`12.000.000 đ`).
- **Schema changes** — drop the `profile_auth_fk` over `DIRECT_URL` → `prisma db push` → `node scripts/profile-auth-fk.mjs` → `prisma generate` → restart. `prisma db push` alone fails on that FK.
- **Never commit `.env`.** I cannot write Vercel env values (they land empty) — surface the value for the owner to paste.

## Landmine files

These carry invariants recorded in their own comments. Read the comments before editing; a regression here is a P0:
`listing-card.tsx` · `listing-gallery.tsx` (cover-beat video: eager overlay is the LCP, no `poster` attr) · `listings-explorer.tsx` (pagination sentinel must never be `hidden`; cache adoption is a reference check) · `listings-map.tsx` (popup height-sync; touch two-step) · `messages/[id]/page.tsx` (Enter-first send; `onMouseDown` + `preventDefault`, never `onPointerDown`) · `post-wizard.tsx` · `CardVideo`.

## Shipping

`/ship` runs the ritual: `tsc --noEmit` → design-lint → `npm run build` → local guest e2e (44 tests, server on **port 3100** — 3000 has been squatted by another project) → commit → push → poll `npx vercel ls` until Ready → prod guest suite. Stop at the first red gate. If a push breaks prod, revert to the last known-good commit and pause — don't stack fix-on-fix.
