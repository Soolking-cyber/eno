# eno.vn — working agreement

Vietnamese expat marketplace. Next.js 16 (App Router) · Tailwind v4 · Prisma 7 → Supabase · Vercel. `PRELAUNCH=true` until the owner flips it.

## Model routing — send the work to the right worker

Claude Code has **no automatic per-prompt model router**: the main-loop model is whatever `/model` is set to, and it never changes on its own. Routing therefore happens by *delegation* — each agent and skill below pins its own model and effort, and that pin overrides the session. So the rule is: **don't do cheap work in an expensive main thread, and don't do hard work in a cheap one.**

| Work | Send it to | Runs on |
|---|---|---|
| "Where is X?", "list every call site", "do we already have a helper for this?" | `scout` subagent | Haiku, low effort |
| Reviewing a UI diff for canon drift | `canon-reviewer` subagent | Sonnet, high effort |
| Reviewing copy / bilingual contract | `i18n-reviewer` subagent | Sonnet, high effort |
| Shipping to prod (the whole ritual) | `/ship` skill | Sonnet, medium effort |
| Seller/admin e2e suite | `/authed-e2e` skill | Sonnet, low effort |
| A bug that already survived one plausible fix | `deep-debugger` subagent | **Opus, xhigh** |
| Design, architecture, anything genuinely novel | stay in the main thread | the session model |

Two habits that follow from this:

- **Search via `scout`, not in the main thread.** A grep sweep run at the session's model burns the expensive tier on output you're going to discard. Delegate it and keep the conclusion.
- **Escalate, don't grind.** When a fix doesn't hold the first time, hand it to `deep-debugger` rather than trying a second guess at the current tier. That agent is pinned to Opus at max effort precisely so a cheap session can still get a hard answer.

In a `Workflow`, pass `model` and `effort` per `agent()` call for the same reason — mechanical stages on a cheap tier, verification and judging on an expensive one.

If you want the *session* itself to auto-split, `/model opusplan` plans on Opus and executes on Sonnet. That is the only built-in automatic split; it's by phase, not by prompt complexity.

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
