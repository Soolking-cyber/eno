# eno.vn — working agreement

Vietnamese expat marketplace. `PRELAUNCH=true` until the owner flips it.

## Model routing — top tier everywhere; delegate for isolation, not for savings

**Policy (owner, 2026-07-14): every worker runs on the highest-intelligence model.** No task on this repo gets a downgraded brain — the cost of a missed bug on a live marketplace dwarfs the cost of the tokens. Claude Code has **no automatic per-prompt router** (the main-loop model is whatever `/model` says and never changes on its own), so this is enforced the only way it can be: each agent and skill below pins `model:` explicitly, and that pin overrides the session.

**The dial is `effort:`, not `model:`.** Mechanical retrieval doesn't need deep reasoning; a race condition does. Same intelligence, different amount of thinking.

| Work | Send it to | Model / effort |
|---|---|---|
| "Where is X?", "every call site", "do we already have a helper?" | `scout` | Opus · low |
| UI diff → canon drift | `canon-reviewer` | Opus · high |
| Copy → bilingual contract | `i18n-reviewer` | Opus · high |
| A bug that already survived one plausible fix | `deep-debugger` | Opus · xhigh |
| **Second opinion — run BOTH** (plan AND finished diff; ALSO every security/bug audit — owner 2026-07-23) | `codex` + `antigravity` | **codex GPT-5.6 (sol, high) + Gemini 3.6 Flash (High) — two non-Anthropic families** |
| Second opinion — Anthropic-lineage | `fable-reviewer` | Fable 5 · xhigh |
| Commit-gate third seat | `scripts/second-opinion.mjs` | **Fable 5 · max** (owner, 2026-08-30: *"also use fable 5 as 3rd opnion instead of opus"*; the seat has been qwen → opus → fable → opus → fable). ✅ Same LAB as the author, different MODEL — so a 3/3 is **two** independent families agreeing plus a cousin, not the author nodding at itself. codex and agy are the seats that can surprise you; if they split and fable sides with the author, go and measure. Past 180KB agy stops counting, so the quorum becomes codex + fable. |
| Shipping to prod (the whole ritual) | `/ship` | Opus · medium |
| Seller/admin e2e suite | `/authed-e2e` | Opus · low |
| Design, architecture, anything genuinely novel | main thread | session model |

Three habits that follow:

- **Delegate search to `scout`.** Not to save money — to keep bulk grep output out of the main context. You get the conclusion, not the file dump.
- **Escalate, don't grind.** A fix that didn't hold goes to `deep-debugger` (Opus, xhigh), not to a second guess at the same altitude.
- **Four families, not one — and the commit gate is now down to two.** Main thread is Opus, `fable-reviewer` is Fable 5, and the two DEFAULT external reviewers are **codex (GPT-5.6 sol, high)** and **antigravity (Gemini 3.6 Flash, High)** — run BOTH on substantive code, on the PLAN and the finished diff, and on **every security or bug audit** (owner 2026-07-15; codex removed 2026-07-21 during an account outage, **RESTORED by the owner 2026-07-23** — "codex is not banned, add codex to loop when planning"). ⚠️ **VERIFY a reviewer's factual claims** — on 2026-07-23 Gemini called two TRUE facts (VN's 63→34 province merger, MPI→Ministry-of-Finance) "hallucinations" because its training predates the mid-2025 reforms; both were confirmed via primary sources. Test what a reviewer tells you rather than trusting it. They fail differently, which is the whole point: an Opus review of Opus code shares its blind spots. **Anything irreversible or money/trust-adjacent — offers, publish gate, contact reveals, conversations, payments, anything that writes to prod — gets at least one non-Opus reviewer before it ships.** When everyone agrees, that's when to ask the dissenter, not when to relax. ⚠️ If codex starts erroring with *"model is not supported when using Codex with a ChatGPT account"*, that is the account/credits state, not a config bug — fall back to Gemini and carry on rather than burning turns on it.
- **TWO MOMENTS, NOT ONE (owner, 2026-07-22 — applies to Kai and Murat equally).** The second
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

**How to invoke them** — exact CLI flags, the anti-exploration preamble, and the silent-failure
modes are in the `second-opinion` skill. Load it before dispatching; do not reconstruct the flags
from memory.

## Non-negotiables

- **Design canon** — `docs/design-language.md` is enforced by `scripts/design-lint.mjs` (runs in `npm run lint`, at the head of `npm run build`, and on every `.tsx` edit via a PostToolUse hook). Type scale, radius tiers, tokens-only color. `text-body` in markup is a **color** utility, not a size.
- **Base UI is the primary UI library — this is a standing policy (owner, 2026-07-15), not a preference.** Any new interactive or structural UI element uses Base UI (`@base-ui/react`) via a `src/components/ui/*` primitive. **The order of preference is fixed: (1) a Base UI component; (2) if Base UI genuinely has no equivalent, the best-in-class purpose-built library** (that is why `carousel`=embla, `input-otp`, `sonner` exist — Base UI ships no carousel/OTP/toast); **(3) hand-rolled only as a last resort, and only with a comment saying which of (1)/(2) was ruled out and why.** Before hand-rolling ANY control, floating layer, menu, tab strip, radio group, or field, check `node_modules/@base-ui/react/` — the app shipped a 17-call-site select, faked radio groups, and four hand-rolled popovers precisely because this step was skipped. A hand-rolled widget assembled out of `<Button>`s and a `createPortal` is still a hand-roll and still a violation, even though every piece is a "primitive": `design-lint` now fails the build on `createPortal` outside `ui/` for exactly this reason. When a call site seems to *need* a hand-roll, suspect the PRIMITIVE first — ~116 controls in the sweep stopped being "impossible" once the primitive grew the variant they needed. The deliberate exception is `ui/avatar` (hand-rolled on purpose: Base UI's Avatar withholds the `<img>` until load, which strips it from SSR and costs the LCP on a photo marketplace — the reason is in the file).
- **Primitives** — reuse `src/components/ui/*` and `<ListingCard>` / `<SellerCard>`. `<Button variant="cta">` is the one brand CTA. We're on Base UI: compose with the **`render` prop, not `asChild`** (our `ui/button` is the sole exception, bridging one to the other).
- ⚠️ **`className` on a `render`/`asChild` CHILD is CONCATENATED, not merged.** Base UI's `mergeProps` does no tailwind-merge; only a primitive's *own* `className` goes through `cn()`. So a class on the child does **not** override the primitive's base — the two both land in the class list and **stylesheet order decides**, which is not weight order: `.font-medium` is emitted *after* `.font-bold`, and `.gap-2` after `.gap-1.5`. A child's `font-bold` therefore silently loses to the base `font-medium`. **Put any override that collides with a base class on the primitive (`<Button className="font-bold">`), never on the child.** Verify with the built CSS, not by reasoning: `grep -o '\.font-[a-z]*' .next/static/chunks/*.css`.
- **`ui/button` inflates small icons** — its base carries `[&_svg:not([class*='size-'])]:size-4`, which outspecificities an `h-3`/`h-3.5` icon and blows it up to 16px. Don't wrap a button whose icons are smaller than 16px.
- **A JSX `{/* comment */}` is only valid as a child.** In expression position — inside a ternary branch, or right after `return (` — it is a syntax error, not a comment.
- **i18n** — every user-facing string via `tr(en, vi)` / `<Tr>`; regenerate `src/generated/ui-strings.ts` after adding copy (a hook does it); curated Vietnamese goes in `src/generated/vi-overrides.ts`. Admin chrome is EN-only by convention. English is a translation **target**, not just the source.
- **Money** — always through `src/lib/vnd.ts`; Vietnamese uses dots as thousands separators (`12.000.000 đ`).
- ⛔ **SCHEMA CHANGES — `prisma db push` AND `npm run db:setup` NOW DESTROY DATA. DO NOT RUN THEM.**
  Measured 2026-08-03: the database holds **67 tables against 52 Prisma models**. `db push`
  reconciles the DB *to* the schema, so it generates **18 `DROP TABLE`** statements for everything
  Prisma does not manage — `visa_applications` (live applicant PII), `visa_events`,
  `visa_documents`, `visa_payments`, `next_cache` (~8k rows), `rl_window`/`rl_cooldown` (the
  Postgres rate limiter), `zalo_oauth_token` (the rotating OTP chain), `ListingImageHash`,
  `PlaceGeocode`, `forum_translations`. This flow was safe when written and silently became lethal
  as tables were added outside Prisma.

  **The safe flow — generate SQL, read it, apply only what is additive:**
  1. Drop BOTH cross-schema FKs (`profile_auth_fk`, `visa_applications_user_id_fkey`) — Prisma
     cannot introspect past either, and there are TWO, not one.
  2. `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
  3. **Read the output.** Filter to `ADD COLUMN` / `CREATE TABLE` / `CREATE INDEX` / `ADD CONSTRAINT`.
     ⚠️ A Prisma `ALTER TABLE` is MULTI-CLAUSE: matching how a statement *starts* proves nothing
     about its tail. One carried `ALTER COLUMN "unsubscribeToken" DROP DEFAULT` behind the
     `ADD COLUMN`s. Assert on the whole statement, and reject **any** `DROP`, not a list of kinds.
  4. Apply with `psql -v ON_ERROR_STOP=1` inside `BEGIN/COMMIT`, restore both FKs, then
     `node scripts/compliance-ddl.mjs` and the other DDL scripts, then `prisma generate`.
  5. **Migrate the DB BEFORE deploying.** Prisma selects every scalar column, so a new revision
     against an old schema throws `42703 undefined_column` on any unscoped query
     (`src/lib/admin.ts:44` is one). New columns are additive, so the old revision is unaffected —
     DB first is always the safe order.
- **Never commit `.env`.** I cannot write the deployed env values (GCP Secret Manager, `eno-root-env`) — surface the value for the owner to paste.

## Landmine files

These carry invariants recorded in their own comments. Read the comments before editing; a regression here is a P0:
`listing-card.tsx` · `listing-gallery.tsx` (cover-beat video: eager overlay is the LCP, no `poster` attr) · `listings-explorer.tsx` (pagination sentinel must never be `hidden` — a hidden sentinel is never intersected and pagination dies silently; cache adoption is a reference check) · `listings-map.tsx` (popup height-sync; touch two-step) · `post-wizard.tsx` (the title field's id must stay exactly `pw-title` — `scrollToMissing()` does `getElementById('pw-' + key)`) · `CardVideo`.

`messages/[id]/page.tsx` deserves its own line, because the invariant here is easy to state backwards. **Text mode DOES have a tap-Send button** (the Zalo/FB pattern). The real rule is *why* it's safe: `ChatSendButton` fires on **`onMouseDown` + `preventDefault`, never `onPointerDown`** — that holds the composer's focus, so the tap can't blur the field, dismiss the keyboard, and shift the button out from under the finger. That focus-hold is the invariant; "no tap-Send" was an earlier workaround and is **obsolete** — don't let anyone "restore" it. Enter still sends (`enterKeyHint="send"`), and the Counter button must stay gated by `negotiable !== false` (a counter sends an offer; on a fixed-price listing the server 409s and docks the buyer's trust).

## ⚠️ WS NUMBERS ARE NOT UNIQUE — CLAIM ONE BEFORE YOU USE IT (2026-08-06)

Two sessions worked the `ws0-wire-the-gates` branch in parallel and collided **three times**:
there are now **two WS5s** (fail-open guards / docs + destructive command), **two WS7s** (offer
correctness / product-feed PII), **and no WS6 from one of them**. Nobody lost work — the commits
are disjoint and all landed — but the numbering no longer identifies anything, which matters
because the commit messages hand findings forward by number ("WS2 reported and did not fix…").

**Before starting a stream, run `git log --oneline main..HEAD | grep -iE '^[0-9a-f]+ WS[0-9]'`
and take the next FREE number.** The branch is the shared registry; there is no other one. If the
number you want is taken, take the next one rather than qualifying it — "WS8" beats "WS7b".

Two more habits that came out of the same collision, both cheap:

- **`git commit` commits the INDEX, not your pathspec-shaped intent.** If the other session has
  files staged, a plain `git commit -m` sweeps them into your commit under your message. This
  happened twice. Commit with an explicit pathspec (`git commit -F - -- ':(literal)path'`) AND
  **read the `--stat` afterwards**: a file you touched for two lines showing 60 insertions is the
  tell. `git add -A` and `commit -a` remain banned for exactly this reason.
- **Re-read `git log` before quoting a diff to a reviewer.** A review prompt built from
  `git show HEAD` returned a REFUTED verdict on a correct fix, because HEAD had moved to the other
  session's commit between writing the code and asking about it. Cite the SHA you mean.

## One session at a time (owner, 2026-07-27) — the cockpit is CLOSED

**The multi-agent cockpit was retired on 2026-07-27. Owner's verdict: _"this experimental
work didnt prove itself i will work with 1 agent at a time"_.** Do not recreate it, do not
spawn worker seats, and do not reintroduce a claim/board protocol unless the owner asks.

The branches, worktrees, board, claim mutex and `SessionStart` hook were all removed; nothing
was discarded, and the record is read-only in `docs/cockpit-archive/`.

**How work happens now:** one session, working directly in `~/eno.vn` on `main`, planning
and implementing and shipping in the same place. There is no worker to delegate to and no
seat to claim, so `$ENO_SESSION` is meaningless — ignore it if you see it set.

**What survives the closure, because it was never about parallelism:**
- **`git add -A` and `commit -a` stay BANNED.** They scooped mid-flight work into broken
  commits twice (5550b99b, 72aea9b6). Commit by literal pathspec:
  `git commit -m "…" -- ':(literal)path'`, after reading back `git diff HEAD -- <paths>`.
  A dirty file you did not create is still someone else's — on 2026-07-27 `main` held
  unattributed iOS edits including a corrupted bundle id; the right move was to park them,
  not commit them.
- **Subagents are still the right tool** for search fan-out and second opinions (see Model
  routing above). Retiring the cockpit retired long-lived *worker personas with their own
  branches* — not delegation itself.
- **Second opinions at BOTH plan and diff** remain mandatory on substantive work, and
  saying "single-sourced" out loud when only one family answered.


## ⛔ EVERY FIX SHIPS TO BOTH SITES (owner, 2026-08-02)

**Owner's words: _"make sure all fixes reach forum too unless i specify visa itinerary fix"_.**

The DEFAULT is both. eno.vn and eno.forum are one codebase deployed twice, so a change under
`src/**` reaches both for free — the burden of proof is on gating, not on sharing. Gate with
`IS_MARKETPLACE` / `IS_SERVICES` **only** for the legal boundary: visa, itinerary, PayPal, and
copy that names them. Nothing else. A bug fix, a layout change, an auth fix, a footer field is
for both sites unless the owner says otherwise.

### ⚠️ THE TRAP IS CONFIG, NOT CODE — it is per-site and silently only ever gets done once

Code is shared automatically. Everything AROUND the code is duplicated per site and has no
compiler to catch a half-applied change. Both of these were found on 2026-08-02, each shipped
to eno.vn and quietly skipped on eno.forum:

- **Turnstile hostname allowlist** held only `eno.vn`, while BOTH editions ship the same site
  key — so the widget threw `110200` on eno.forum, no token was ever minted, and **email
  sign-in was failing for every real forum user**. Verified by rendering the widget under three
  origins; fixed to `eno.vn, www.eno.vn, eno.forum, www.eno.forum, localhost`.
- **The forum's Cache Rule matched `http.host eq "eno.forum"`** — the APEX — while
  `NEXT_PUBLIC_APP_URL` for the services edition is `https://www.eno.forum`. So every real
  request was uncached (`DYNAMIC`) while the apex showed `HIT`, which is exactly the shape that
  makes a spot-check say "working". Both zones now match `http.host in {apex www}`.
  ⚠️ Its sibling `_next/image` rule tested `starts_with(http.request.full_uri, "/_next/image")`
  — `full_uri` is the COMPLETE url (`https://host/...`), so that can never be true and the rule
  had never once matched. Use `http.request.uri.path`.

So when a change touches any of these, do it TWICE and verify TWICE:
Cloudflare zones (`eno.vn` = `55e558b6…`, `eno.forum` = `cc81e3ff…`) · Secret Manager
(`eno-root-env`, `eno-services-env`) · Turnstile · Supabase URL config. (Cloud Build triggers: gone, 2026-08-22.)

## ⛔ DEPLOY ONLY WHEN THE OWNER SAYS "DEPLOY" (owner, 2026-08-02)

**Owner's words: _"i will tell you when to deploy from now on and all tested locally"_.**
This REPLACES the previous standing instruction to always push once gates are green.

**Why it changed:** eno.vn is going live. A launched marketplace cannot be the place a
change is tried out, and 2026-08-02 showed exactly how that goes — the hero heading was
rewritten five times ON PRODUCTION in one afternoon, each round costing a build, a
cache purge and an owner screenshot to discover something a local preview would have shown
in thirty seconds.

**The mechanism, and it INVERTED on 2026-08-22:** Cloud Build was removed entirely (owner:
*"remove cloud build entirely we preview locally and deploy on box from now on all future
changes"*). Both triggers are deleted and `cloudbuild.yaml` / `cloudbuild.services.yaml` are
gone — see `docs/history/cloudbuild-removal.md`, which keeps their definitions verbatim.

⛔ **A PUSH TO MAIN IS NO LONGER A DEPLOY.** Pushing runs CI and nothing else. Code reaches
users only when `infra/vn-node/eno-deploy.sh` is run ON THE BOX (162.4.176.208). That script
is the entire path: pull → build both editions → verify the marketplace bundle carries no
visa/itinerary routes → swap → health-check through Cloudflare → auto-rollback on failure.

⚠️ **THE OLD RULE WAS SAFER IN ONE WAY AND THIS ONE IS SAFER IN ANOTHER — know which risk you
now carry.** Before, the danger was deploying by accident; a push shipped instantly. Now the
danger is the opposite and it has ALREADY HAPPENED: when DNS moved to the box, Cloud Build
kept deploying Cloud Run faithfully for a full day while nobody pulled the box, and
production sat **fourteen commits behind including seven security fixes** with every
pipeline green. Nothing warns you about this. If you pushed and did not run the deploy
script, **users do not have your change**, however green CI looked.

⚠️ `git commit` and `git push` are both fine and expected — neither ships anything. What is
gated is running the deploy script, which is the owner's call per *"i will tell you when to
deploy"*. `/ship` step 5 is that step; a ship that stops at push has shipped nothing.

### Local review, before saying anything is ready

```bash
npm run dev:vn          # marketplace, :3000   — fast iteration, hot reload
npm run dev:forum       # services,    :3001   — ⚠️ NOT at the same time, see below
npm run preview:vn      # marketplace, :3000   — PRODUCTION build, the real artifact
npm run preview:forum   # services,    :3101   — CAN run alongside a dev server
npm run verify:local    # unit + tsc + smoke + seo + content + sec-probe vs :3000
E2E_BASE=http://localhost:3000 npm run e2e:guest
```

⚠️ **THE MARKETPLACE LIVES ON :3000 AND NOTHING ELSE (owner, 2026-08-17: "kill 3000 and 3100
use only 3000 from now on").** `dev:vn` and `preview:vn` deliberately share the port — you
are meant to run ONE of them, and `preview.mjs` kills whatever holds :3000 before binding.
The old split (dev on 3000, preview on 3100) existed to dodge a squatting `next-server`, and
it cost more than it saved: two ports meant two things to check, and on 2026-08-17 a
**three-day-old** server on :3000 served stale code that read as a live bug, while the real
build sat on :3100. One port, force-claimed, so "what is on :3000" has exactly one answer.
⚠️ A server that loses the bind does NOT fail loudly — Node exits with EADDRINUSE and the OLD
process keeps answering 200 (`next dev` is worse: it silently moves to :3001). `preview.mjs`
and `dev:vn` both free the port BEFORE building, via `scripts/free-port.mjs`, which aborts
rather than continuing if it cannot take it.
⛔ **So wait for the `── serving` line, never for the port to answer 200.** The port is free
for the whole build, so a 200 in that window is by definition another server — polling for one
runs your suite against the wrong build and then loses it mid-run when the real one binds.
`preview.mjs` emits that line only after confirming the child it spawned is alive AND holding
the port. ⚠️ **Bound the wait and watch the process** (`kill -0 $!`): a build failure never
writes the marker, so a bare `until grep` turns a RED gate into a silent hang. The recipe is
in the `ship` skill — copy it rather than improvising one.

⚠️ **:3000 no longer implies "production build" — that is the accepted cost of one port.**
`dev:vn` and `preview:vn` both live there, so `verify:local` / `e2e:guest` pointed at :3000
while a dev server is up will happily test `next dev`, which does not exercise prerendered ISR
HTML, inlined `NEXT_PUBLIC_*`, or edition exclusion. Start the preview yourself and wait for
its marker; do not inherit whatever is already running.

**`preview` is a clean production build, not `next dev`, and the difference is the point.**
Three bug classes are invisible in dev and have each reached prod: prerendered ISR HTML (the
home page bakes listing data at build time), the inlined `NEXT_PUBLIC_*` values every
canonical and OG url derives from, and edition exclusion (`.svc.` routes only disappear
because `next build` resolves `pageExtensions`). `preview` also wipes `.next` first, because
a stale chunk from the other edition survives an incremental build — the leak class
`edition-lint` exists to catch.

⚠️ **One edition at a time**: both build into the same `.next`, so the second overwrites the
first. Run it twice when a change touches both. And `npm run start` alone is NOT a preview —
`next build` does not copy `.next/static` or `public/` into the standalone bundle (the
Dockerfile does it in two COPY lines), so every asset 404s. `scripts/preview.mjs` does that
copy; that is most of why it exists.

### After a deploy the owner DID authorise

⚠️ **Purge Cloudflare with `purge_everything`, not by URL.** Purge-by-file returns
`success: true` and silently does nothing on the cached HTML routes — the `vary: normalize`
cache key includes the encoding variant. Measured 2026-08-02: `age: 850` a minute after a
"successful" purge, which is how eno.forum picked up a commit while eno.vn served pre-deploy
HTML from the SAME green build. Without it, a deploy is invisible for up to 6h.

## Shipping

**Forum deployment boundary — cutover complete (owner, 2026-07-18; narrowed 2026-07-21 and
again 2026-07-25):** `/Users/mk1e3/eno.vn/apps/forum` is the only source of truth for
`eno.forum`, including the forum and concierge surfaces (**e-Visa was removed from this list —
see "Visa ownership" below**). Make all such changes only under `apps/forum/**`.

**⚠️ ITINERARY IS NO LONGER A FORUM SURFACE (owner, 2026-07-25).** The trip service belongs to
**eno.vn end to end** — the public landing page (`src/app/itinerary/page.tsx`), the builder and
My Trips (`src/app/dashboard/trips/**`), the APIs (`src/app/api/itineraries/**`) and the libs
(`src/lib/itinerary-*.ts`). The forum's duplicate builder, its generate/docx routes, its
`/itinerary` page and its copies of the libs were **DELETED**; `apps/forum/next.config.ts` 308s
`/itinerary*` to `https://eno.vn/itinerary` and that redirect must outlive the deletion. Do not
recreate an itinerary surface under `apps/forum/**`, and do not "restore" the retired
`itinerary-resources` sync-pair — `src/lib/itinerary-resources.ts` is single-owner now. The
former `/Users/mk1e3/eno-forum` checkout and `Soolking-cyber/eno-forum` repository are
retired migration history: never edit, push, or deploy from them. The `eno.forum`
deployment stays a separate service (it owns the forum domains and environment
variables) but builds from `Soolking-cyber/eno` with root directory `apps/forum`.

**⛔⛔ THE 2026-07-29 RULE BELOW IS REVERSED — READ THIS FIRST (owner, 2026-07-31).**
eno.vn is registering as a licensed Vietnamese company (sàn TMĐT) and **cannot legally
offer e-visa services, itinerary services, or PayPal checkout**. Those move to
**eno.forum**. The owner's words: *"we need 2 identical apps 1 legal for vietnam eno.vn
to get licenses and register company the other one eno.forum to serve the evisa and
itinerary services since eno.vn cant legally have them … we cant have paypal checkout
in eno.vn only in eno.forum so visa and itinerary related ui should be visible only in
forum one"*.

**The architecture is ONE SHARED CODEBASE, not two.** The repo root is deployed **twice** —
as two containers on the VN box (`eno-vn:local` on :3001, `eno-forum:local` on :3002; this
said "two Cloud Run services" until 2026-08-23, when those were deleted). An edition flag
decides which surfaces are live, and it is inlined at BUILD time, so the image IS the
edition — no runtime flag can talk one into behaving as the other. Do not fork,
do not port files into `apps/forum`, and do not let the two drift — drift is exactly what
this replaces. `apps/forum` (a separate 102-file app sharing no code with the root) gets
**retired**, and eno.forum is served by the root codebase.

| | eno.vn | eno.forum |
|---|---|---|
| marketplace | ✅ | ✅ (identical) |
| visa · itinerary · PayPal | ⛔ **not even a mention** | ✅ |

⚠️ **This is a legal boundary, not a feature flag.** The failure mode is a LEAK: any place
eno.vn still shows, links to, describes, indexes, emails or serves one of those surfaces
means the licensed company is advertising a service it is not licensed for. ⚠️ **Visa
products are ordinary `Listing` rows sharing one `Seller` with the trip desk**, so browse,
search, rails, sitemap, JSON-LD and the Google/Meta feeds leak them unless filtered — that
is the likeliest thing to be missed, and it has nothing to do with the `/visa` pages.

The two apps **share one database**, which means a eno.vn user's thread can already contain
visa cards written by eno.forum. Degrade, never crash.

⚠️ THE SUPERSEDED 2026-07-29 NARRATIVE THAT SAT HERE WAS REMOVED 2026-08-05. It described an
ownership direction that the 2026-07-31 reversal above already inverted, and it was labelled
"historical context" in its own first line — ~39 lines every session paid to read a rule that no
longer applied. Recover it from git history if the archaeology is ever needed.

Two items from that block ARE still live, verified 2026-08-05, and are kept here:

- ⛔ **The Browserbase hosted-prefill operator flow exists ONLY in the forum tree**
  (`apps/forum/src/lib/visa/hosted-prefill.ts`, `api/visa/admin/applications/[id]/prefill-session`,
  `api/visa/prefill/[token]` — file confirmed present). eno.vn has no Browserbase code at all, so
  deleting it removes a capability rather than a duplicate. Port it or have the owner confirm it is
  abandoned BEFORE deleting the forum visa tree.
- ⚠️ `src/lib/sync-pairs.test.ts` (confirmed present) byte-couples six `src/lib/visa/*` files
  (`mrz` · `image-quality` · `image-normalization` · `checkpoints` · `schema` · `crypto`) to their
  forum copies, so editing one of those on the eno.vn side **fails the root vitest suite** until the
  pair is mirrored or retired from the test. Check that list before touching `src/lib/visa/**`, and
  prefer putting new visa logic in files that are not sync-paired.

The visa admin identity is **`support@eno.vn`** (`apps/forum/src/lib/visa/auth.ts:5`) —
`support@eno.forum` in any doc or env is stale.

⚠️ `apps/forum/**` STILL EXISTS IN THE REPO (33,884 files, measured 2026-08-05) even though its
Cloud Run service and build trigger were deleted. The owner's instruction was *"dont delete project
itself let it sit in git so we can host it later"* — so it is dormant source, not dead source: do
not delete it, and do not treat its presence as evidence that eno.forum is deployed.

**Codex handoff boundary (owner, 2026-07-18):** Codex only edits and validates
`apps/forum/**`; it must not commit, push, trigger a deploy, or run the shipping workflow.
Claude owns the whole-monorepo commit and push, after which Cloud Build builds and deploys
to Cloud Run.

**Mandatory Codex pickup (owner, 2026-07-18):** At the start of every shipping pass
and immediately before staging, Claude must run `git status --short -- apps/forum` and
inspect `git diff -- apps/forum`. Pending files there are a Codex handoff. If Codex
reported the relevant forum gates green, include those files in the same commit; if
their readiness is unclear, rerun the forum gates or stop and report the exact files.
Never push while silently leaving validated Codex work under `apps/forum/**` unstaged.

`/ship` runs the shipping ritual — the gates, their order and the E2E_BASE trap are in the `ship` skill; load it rather than reconstructing them. Stop at the first red gate. If a push breaks prod, revert to the last known-good commit and pause — don't stack fix-on-fix.

⚠️ **A GREEN DEPLOY IS NOT A GREEN PIPELINE — read `gh run list --limit 3` after every push.**
GitHub Actions is a **separate gate** from Cloud Build: Cloud Build only builds and deploys, while
the Actions `CI` workflow runs checks the deploy does not. On 2026-07-27 it was found red on **8
consecutive commits** (07-26T17:43 → 07-27T02:44) because the ritual polled Cloud Build, saw
SUCCESS + a new Cloud Run revision, and reported each push as shipped. Prod was fine and the repo
was failing, simultaneously. A red Actions run pages nobody and blocks nothing, so it rots silently.

The check that was failing is the **`src/generated/ui-strings.ts` drift guard**, and its trap is
worth knowing: a PostToolUse hook regenerates that file on `.tsx` edits, so it is normally
invisible — but **a commit made outside this checkout never ran the hook**, so merging such a branch
brings new `tr()` copy WITHOUT the regenerated strings file. The drift therefore appears at MERGE
time, in a file nobody edited. **After merging any branch that adds copy, run
`node scripts/gen-ui-strings.mjs` and commit it.**
