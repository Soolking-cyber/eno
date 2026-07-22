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
| A bug that already survived one plausible fix | `deep-debugger` | Opus · xhigh |
| **Second opinion — run BOTH** | `codex` + `antigravity` | **GPT-5.6 + Gemini 3.1 Pro (High) — two non-Anthropic families** |
| Second opinion — Anthropic-lineage | `fable-reviewer` | Fable 5 · xhigh — **budget-limited, use sparingly** |
| Shipping to prod (the whole ritual) | `/ship` | Opus · medium |
| Seller/admin e2e suite | `/authed-e2e` | Opus · low |
| Design, architecture, anything genuinely novel | main thread | session model |

Three habits that follow:

- **Delegate search to `scout`.** Not to save money — to keep bulk grep output out of the main context. You get the conclusion, not the file dump.
- **Escalate, don't grind.** A fix that didn't hold goes to `deep-debugger` (Opus, xhigh), not to a second guess at the same altitude.
- **Four families, not one.** Main thread is Opus, `fable-reviewer` is Fable 5, and the two DEFAULT external reviewers are **codex (GPT-5.6)** and **antigravity (Gemini 3.1 Pro, High)** — run BOTH on substantive code (owner 2026-07-15; codex removed 2026-07-21 while its account was failing, **restored the same day once it answered again**). They fail differently, which is the whole point: an Opus review of Opus code shares its blind spots. **Anything irreversible or money/trust-adjacent — offers, publish gate, contact reveals, conversations, payments, anything that writes to prod — gets at least one non-Opus reviewer before it ships.** When everyone agrees, that's when to ask the dissenter, not when to relax. ⚠️ If codex starts erroring with *"model is not supported when using Codex with a ChatGPT account"*, that is the account/credits state, not a config bug — fall back to Gemini and carry on rather than burning turns on it.
- **TWO MOMENTS, NOT ONE (owner, 2026-07-22 — applies to Kyle and Murat equally).** The second
  opinion is mandatory at BOTH ends of a task, and they catch different things:
  **(1) PLANNING** — before writing code for anything non-trivial, hand over the plan and ask
  both to attack it. On 2026-07-22 this turned a native-email-OTP design inside out: a probe
  proved `verifyOtp({type:'email'})` accepts tokens minted for both new and existing accounts,
  which deleted a custom endpoint, a hand-rolled lockout, and an enumeration leak from the plan
  before a line was written. A review after the fact would have blessed the worse design.
  **(2) REVIEW OF THE FINISHED JOB** — after gates pass, before you call it done. Same day,
  Gemini caught a PKCE/fragment defect that would have broken every magic link, and codex caught
  `Combobox.Item` rendered as a native `<button>` — a focus bug that a passing click-through test
  cannot see, because clicking still worked.
- **⚠️ A REVIEWER THAT DID NOT ANSWER IS NOT A PASSED REVIEW.** They fail silently and often, in
  three distinct ways seen on 2026-07-22 alone: a network error ("Network is unreachable"), a
  headless permission prompt Gemini cannot answer (fix: an allow-rule, or
  `--dangerously-skip-permissions`), and codex burning an entire run reading `node_modules`
  without ever reaching a verdict. **Before treating a review as done, confirm a VERDICT exists
  in the output** — not just that the process exited 0. If none landed, say so out loud in the
  commit and in the handoff rather than implying the code was reviewed. Adjudicating it yourself
  is an acceptable fallback; pretending it was reviewed is not.
- **Ask it to REFUTE, not to "review".** The highest-signal second opinion adjudicates a specific claim ("confirm or refute this, with evidence") rather than requesting a fresh opinion. That framing caught a ship-blocker on 2026-07-21 that an open-ended review would have missed.

**How to invoke the two external reviewers (both read-only, non-interactive):**
- **codex** — pipe the prompt via STDIN, never as an argument (the arg form hangs waiting on stdin).
  **Owner-set invocation (2026-07-21) — use exactly this:**
  `echo "<review prompt>" | codex exec -m gpt-5.6-sol -c model_reasoning_effort=high --sandbox read-only`
  (or heredoc into stdin). Verify the banner echoes `model: gpt-5.6-sol` / `reasoning effort: high`.
- **antigravity** — `agy -p "<prompt>" --model "Gemini 3.1 Pro (High)"`. ⚠️ If it returns
  *"a tool required the command permission that headless mode cannot prompt for"*, it produced NOTHING —
  that is not a review. Re-run with `--dangerously-skip-permissions` (it is read-only anyway) or add an
  allow-rule. Seen 2026-07-22. Feed the file CONTENT inline in the
  prompt (its agentic file-reading mode times out on `--print-timeout`); use `--print-timeout 240s`.
- Dispatch them **directly and in PARALLEL** as background jobs — never sequenced, never wrapped in an Opus
  subagent that shells out on their behalf.

In a `Workflow`, pass `model` and `effort` per `agent()` call for the Opus/Fable fan-out, and shell out to
`codex exec` / `agy -p` from inside agents (or the main thread) for the two external families. Cross-family
verification is the highest-value use: find with one family, have the others try to refute.

## Non-negotiables

- **Design canon** — `docs/design-language.md` is enforced by `scripts/design-lint.mjs` (runs in `npm run lint`, at the head of `npm run build`, and on every `.tsx` edit via a PostToolUse hook). Type scale, radius tiers, tokens-only color. `text-body` in markup is a **color** utility, not a size.
- **Base UI is the primary UI library — this is a standing policy (owner, 2026-07-15), not a preference.** Any new interactive or structural UI element uses Base UI (`@base-ui/react`) via a `src/components/ui/*` primitive. **The order of preference is fixed: (1) a Base UI component; (2) if Base UI genuinely has no equivalent, the best-in-class purpose-built library** (that is why `carousel`=embla, `input-otp`, `sonner` exist — Base UI ships no carousel/OTP/toast); **(3) hand-rolled only as a last resort, and only with a comment saying which of (1)/(2) was ruled out and why.** Before hand-rolling ANY control, floating layer, menu, tab strip, radio group, or field, check `node_modules/@base-ui/react/` — the app shipped a 17-call-site select, faked radio groups, and four hand-rolled popovers precisely because this step was skipped. A hand-rolled widget assembled out of `<Button>`s and a `createPortal` is still a hand-roll and still a violation, even though every piece is a "primitive": `design-lint` now fails the build on `createPortal` outside `ui/` for exactly this reason. When a call site seems to *need* a hand-roll, suspect the PRIMITIVE first — ~116 controls in the sweep stopped being "impossible" once the primitive grew the variant they needed. The deliberate exception is `ui/avatar` (hand-rolled on purpose: Base UI's Avatar withholds the `<img>` until load, which strips it from SSR and costs the LCP on a photo marketplace — the reason is in the file).
- **Primitives** — reuse `src/components/ui/*` and `<ListingCard>` / `<SellerCard>`. `<Button variant="cta">` is the one brand CTA. We're on Base UI: compose with the **`render` prop, not `asChild`** (our `ui/button` is the sole exception, bridging one to the other).
- ⚠️ **`className` on a `render`/`asChild` CHILD is CONCATENATED, not merged.** Base UI's `mergeProps` does no tailwind-merge; only a primitive's *own* `className` goes through `cn()`. So a class on the child does **not** override the primitive's base — the two both land in the class list and **stylesheet order decides**, which is not weight order: `.font-medium` is emitted *after* `.font-bold`, and `.gap-2` after `.gap-1.5`. A child's `font-bold` therefore silently loses to the base `font-medium`. **Put any override that collides with a base class on the primitive (`<Button className="font-bold">`), never on the child.** Verify with the built CSS, not by reasoning: `grep -o '\.font-[a-z]*' .next/static/chunks/*.css`.
- **`ui/button` inflates small icons** — its base carries `[&_svg:not([class*='size-'])]:size-4`, which outspecificities an `h-3`/`h-3.5` icon and blows it up to 16px. Don't wrap a button whose icons are smaller than 16px.
- **A JSX `{/* comment */}` is only valid as a child.** In expression position — inside a ternary branch, or right after `return (` — it is a syntax error, not a comment.
- **i18n** — every user-facing string via `tr(en, vi)` / `<Tr>`; regenerate `src/generated/ui-strings.ts` after adding copy (a hook does it); curated Vietnamese goes in `src/generated/vi-overrides.ts`. Admin chrome is EN-only by convention. English is a translation **target**, not just the source.
- **Money** — always through `src/lib/vnd.ts`; Vietnamese uses dots as thousands separators (`12.000.000 đ`).
- **Schema changes** — drop the `profile_auth_fk` over `DIRECT_URL` → `prisma db push` → `node scripts/profile-auth-fk.mjs` → `prisma generate` → restart. `prisma db push` alone fails on that FK.
- **Never commit `.env`.** I cannot write Vercel env values (they land empty) — surface the value for the owner to paste.

## Landmine files

These carry invariants recorded in their own comments. Read the comments before editing; a regression here is a P0:
`listing-card.tsx` · `listing-gallery.tsx` (cover-beat video: eager overlay is the LCP, no `poster` attr) · `listings-explorer.tsx` (pagination sentinel must never be `hidden` — a hidden sentinel is never intersected and pagination dies silently; cache adoption is a reference check) · `listings-map.tsx` (popup height-sync; touch two-step) · `post-wizard.tsx` (the title field's id must stay exactly `pw-title` — `scrollToMissing()` does `getElementById('pw-' + key)`) · `CardVideo`.

`messages/[id]/page.tsx` deserves its own line, because the invariant here is easy to state backwards. **Text mode DOES have a tap-Send button** (the Zalo/FB pattern). The real rule is *why* it's safe: `ChatSendButton` fires on **`onMouseDown` + `preventDefault`, never `onPointerDown`** — that holds the composer's focus, so the tap can't blur the field, dismiss the keyboard, and shift the button out from under the finger. That focus-hold is the invariant; "no tap-Send" was an earlier workaround and is **obsolete** — don't let anyone "restore" it. Enter still sends (`enterKeyHint="send"`), and the Counter button must stay gated by `negotiable !== false` (a counter sends an offer; on a fixed-price listing the server 409s and docks the buyer's trust).

## Parallel sessions (owner, 2026-07-19)

Multiple Claude Code sessions may run in THIS worktree concurrently. The standing
setup is the 4-terminal cockpit (`~/eno-cockpit.sh`, auto-ensured by the
SessionStart hook in .claude/settings.json): workers **Kyle** and **Murat**
(Claude Code) plus the second-opinion terminals **Codex** (GPT-5.6) and **Agy**
(Gemini). Run `echo $ENO_SESSION` to learn your name; sign the claims board with
it. Rules:
- **Claims board**: `.claude/COORDINATION.md` — read it before picking up work,
  claim your item (and the TaskList task) there, release when done. Pick tasks
  the other session hasn't claimed.
- **Stage explicitly — `git add -A` at the repo root is BANNED** (it once
  scooped another session's mid-flight edit into a broken commit, 5550b99b).
  Add the exact files you changed.
- Before committing: anything dirty outside your claim belongs to the other
  session — leave it. If HEAD moved since your gates, re-run tsc before push.
- A red pipeline after your push: check whether the other session already
  shipped the fix before writing your own (both sessions watching the same
  build → duplicate fixes collide).

## Shipping

**Forum/itinerary deployment boundary — cutover complete (owner, 2026-07-18; narrowed 2026-07-21):**
`/Users/mk1e3/eno.vn/apps/forum` is the only source of truth for `eno.forum`, including
the forum, itinerary, and concierge surfaces (**e-Visa was removed from this list —
see "Visa ownership" below**). Make all such changes only under `apps/forum/**`. The
former `/Users/mk1e3/eno-forum` checkout and `Soolking-cyber/eno-forum` repository are
retired migration history: never edit, push, or deploy from them. The `eno.forum`
deployment stays a separate service (it owns the forum domains and environment
variables) but builds from `Soolking-cyber/eno` with root directory `apps/forum`.

**Visa ownership — eno.vn owns the WHOLE feature (owner, 2026-07-21):** the Vietnam
e-Visa service belongs to **eno.vn (repo root)** end to end — applicant flow, AI
passport extraction, payments, the in-DM experience, and the admin/operator queue.
Build every visa change under `src/**`; **`apps/forum` must not gain new visa
surfaces.** The visa code still under `apps/forum/**` is legacy awaiting an
owner-approved retirement plan — **do not delete any of it yet**: two capabilities
still exist ONLY there (the PII retention cron `/api/cron/visa-retention`, and the
Browserbase hosted-prefill operator flow), and so do the visa table/bucket migrations.
Per-file inventory and the migration order live in `apps/forum/docs/VISA_ASSISTANCE.md`.
The visa admin identity is **`support@eno.vn`** (`apps/forum/src/lib/visa/auth.ts:5`) —
`support@eno.forum` in any doc or env is stale.
⚠️ `src/lib/sync-pairs.test.ts` byte-couples six `src/lib/visa/*` files
(`mrz` · `image-quality` · `image-normalization` · `checkpoints` · `schema` · `crypto`)
to their forum copies, so editing one of those on the eno.vn side **fails the root
vitest suite** until the pair is mirrored or retired from the test. Check that list
before touching `src/lib/visa/**`, and prefer putting new visa logic in files that are
not sync-paired.

**Codex handoff boundary (owner, 2026-07-18):** Codex only edits and validates
`apps/forum/**`; it must not commit, push, trigger Vercel, or run the shipping workflow.
Claude owns the whole-monorepo commit and push, after which Vercel builds automatically.

**Mandatory Codex pickup (owner, 2026-07-18):** At the start of every shipping pass
and immediately before staging, Claude must run `git status --short -- apps/forum` and
inspect `git diff -- apps/forum`. Pending files there are a Codex handoff. If Codex
reported the relevant forum gates green, include those files in the same commit; if
their readiness is unclear, rerun the forum gates or stop and report the exact files.
Never push while silently leaving validated Codex work under `apps/forum/**` unstaged.

`/ship` runs the ritual: `tsc --noEmit` → design-lint → `npm run build` → local guest e2e (44 tests, server on **port 3100** — 3000 has been squatted by another project) → commit → push → poll `npx vercel ls` until Ready → prod guest suite. Stop at the first red gate. If a push breaks prod, revert to the last known-good commit and pause — don't stack fix-on-fix.
