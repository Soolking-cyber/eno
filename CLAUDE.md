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
| **Second opinion** (plan AND finished diff; ALSO every security/bug audit — owner 2026-07-23) | the seats in `REVIEWER_NAMES` (`scripts/second-opinion.mjs`); load the `second-opinion` skill | as pinned there — never restate the seat list here |
| Second opinion — Anthropic-lineage | `fable-reviewer` | ⛔ **OUT OF BUDGET since 2026-09-09** — do not dispatch. Use Opus · xhigh in its place until the owner says otherwise. |
| Commit-gate panel | `node scripts/second-opinion.mjs` (PreToolUse hook enforces) | seats = `REVIEWER_NAMES`; two labs must answer; Opus is the author's own model, so a REFUTED from a non-Anthropic seat is the real objection — measure it |
| Shipping to prod (the whole ritual) | `/ship` | Opus · medium |
| Seller/admin e2e suite | `/authed-e2e` | Opus · low |
| Design, architecture, anything genuinely novel | main thread | session model |

Three habits that follow:

- **Delegate search to `scout`.** Not to save money — to keep bulk grep output out of the main context. You get the conclusion, not the file dump.
- **Escalate, don't grind.** A fix that didn't hold goes to `deep-debugger` (Opus, xhigh), not to a second guess at the same altitude.
- ⛔ **Never sleep waiting for a reviewer's quota reset.** Seats change only on the owner's word, by editing `REVIEWER_NAMES` (every name needs a seat in `REVIEWERS`; agy's is only skipped) and the other seat-list strings `scripts/second-opinion.mjs` names (the secret-scan message), plus the hook's refusal text (`.claude/hooks/second-opinion.sh`). When only one non-Anthropic family voted, say single-sourced.
- ⚠️ **codex's MEDIUM EFFORT IS DELIBERATE AND IS THE ONE SEAT BELOW the others' high/max.** It is what the owner asked for
  (*"which has normal token consumption and good reasoning needs a balance there"*); do not "correct" it upward.
- ⛔ **A MODEL ID THAT ERRORS TELLS YOU NOTHING ABOUT ONE THAT DOES NOT — MEASURE, DO NOT INFER.** Probe a new id and read the banner before pinning it (the episodes, and agy's transient `invalid model selection`: `second-opinion` skill).
- ⚠️ **VERIFY a reviewer's factual claims** — on 2026-07-23 Gemini called two TRUE facts (VN's 63→34 province merger, MPI→Ministry-of-Finance) "hallucinations" because its training predates the mid-2025 reforms; both were confirmed via primary sources. Test what a reviewer tells you rather than trusting it. They fail differently, which is the whole point: an Opus review of Opus code shares its blind spots. **Anything irreversible or money/trust-adjacent — offers, publish gate, contact reveals, conversations, payments, anything that writes to prod — gets at least one non-Opus reviewer before it ships.** When everyone agrees, that's when to ask the dissenter, not when to relax.
- **TWO MOMENTS, NOT ONE (owner, 2026-07-22 — applies to Kai and Murat equally).** The second
  opinion is mandatory at BOTH ends of a task, and they catch different things:
  **(1) PLANNING** — before writing code for anything non-trivial, hand over the plan and ask
  them to attack it. **(2) REVIEW OF THE FINISHED JOB** — after gates pass, before you call it
  done. (Worked examples: `second-opinion` skill.)
- **⚠️ A REVIEWER THAT DID NOT ANSWER IS NOT A PASSED REVIEW.** **Before treating a review as done, confirm a VERDICT exists
  in the output** — not just that the process exited 0. If none landed, say so out loud in the
  commit and in the handoff rather than implying the code was reviewed. Adjudicating it yourself
  is an acceptable fallback; pretending it was reviewed is not. (Failure modes: `second-opinion` skill.)
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
- **i18n** — every user-facing string via `tr(en, vi)` / `<Tr>`; regenerate `src/generated/ui-strings.ts` after adding copy (a PostToolUse hook does it on Edit/Write only — after a merge or a Bash/sed edit that adds copy, run `node scripts/gen-ui-strings.mjs` and commit BOTH `ui-strings.ts` and `ui-strings.services.ts`); curated Vietnamese goes in `src/generated/vi-overrides.ts`. Admin chrome is EN-only by convention. English is a translation **target**, not just the source.
- ⛔ **PAGES LIVE UNDER `src/app/[lang]/` (2026-09-17) — the HTML is server-rendered in the visitor's language.** `src/proxy.ts` rewrites every page request to `/en/…` or `/vi/…` (cookie `lang`, else Accept-Language; rule in `src/lib/lang-variant.ts`); public URLs never change and a public `/en/…` or `/vi/…` 404s. Consequences: **purge with `revalidatePublicPath()`** (`src/lib/revalidate-lang.ts`) — a bare `revalidatePath('/listings/x')` purges nothing; `next.config.ts` page-path rewrite sources need `/:lang(en|vi)`; ESLint globs must escape `\\[lang\\]`; and the Cloudflare HTML edge-cache rule must not cache page HTML (Free plan cannot key the cache on language). Only en/vi render on the server; the nine MT languages get the English variant and swap client-side.
- **Money** — always through `src/lib/vnd.ts`; Vietnamese uses dots as thousands separators (`12.000.000 đ`).
- ⛔ **SCHEMA CHANGES — `prisma db push`, `prisma migrate dev`/`reset` and `npm run db:setup` DESTROY DATA. DO NOT RUN THEM.**
  `db push` reconciles the DB *to* the schema, so it emits a `DROP` for every table and index Prisma does not manage
  (visa PII, the rate limiter, the OTP chain, the tables the DDL scripts add outside the schema, the partial `Listing` indexes).
  `scripts/db-guard.mjs` refuses the npm forms — NOT a bare `npx prisma db push`. Migrate the DB BEFORE deploying
  (new columns are additive; a new revision on an old schema throws `42703`). Safe additive flow — generate the SQL,
  read it, never apply a `DROP`, and never build an index on an existing table inside the transaction (run
  `CREATE INDEX CONCURRENTLY` alone); drop BOTH cross-schema FKs first (`profile_auth_fk`,
  `visa_applications_user_id_fkey`) and restore both after, and a Prisma `ALTER TABLE` is multi-clause — assert on the whole statement, not
  how it starts. The full flow: `prisma/CLAUDE.md`.
- **Never commit `.env`.** I cannot write the deployed env values (GCP Secret Manager, `eno-root-env`) — surface the value for the owner to paste.

## Landmine files

`src/components/marketplace/` (listing-card, listing-gallery, listings-explorer, listings-map, post-wizard, card-video) and `messages/[id]/page.tsx` carry invariants in their own comments and nested CLAUDE.md; read them before editing — a regression is P0. Never a `poster` attr on the gallery's cover video, never a `hidden` pagination sentinel, and post-wizard's title id stays exactly `pw-title`.
`messages/[id]/page.tsx`: `ChatSendButton` fires on `onMouseDown`+`preventDefault`, never `onPointerDown`; never restore the old no-tap-Send workaround; the Counter button stays gated by `negotiable !== false`.

## One session at a time (owner, 2026-07-27) — the cockpit is CLOSED

Records of what was retired: `docs/cockpit-archive/` (the cockpit), `docs/history/cloudbuild-removal.md` (Cloud Build).

**The multi-agent cockpit was retired on 2026-07-27. Owner's verdict: _"this experimental
work didnt prove itself i will work with 1 agent at a time"_.** Do not recreate it, do not
spawn worker seats, and do not reintroduce a claim/board protocol unless the owner asks.

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
- **`git commit` commits the INDEX, not your pathspec-shaped intent.** If another session has
  files staged, a plain `git commit -m` sweeps them into your commit under your message. This
  happened twice. Commit with an explicit pathspec (`git commit -F - -- ':(literal)path'`) AND
  **read the `--stat` afterwards**: a file you touched for two lines showing 60 insertions is the
  tell.
- **Re-read `git log` before quoting a diff to a reviewer.** A review prompt built from
  `git show HEAD` returned a REFUTED verdict on a correct fix, because HEAD had moved to another
  session's commit between writing the code and asking about it. Cite the SHA you mean.
- **Subagents are still the right tool** for search fan-out and second opinions (see Model
  routing above). Retiring the cockpit retired long-lived *worker personas with their own
  branches* — not delegation itself.


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

⛔ **A PUSH TO MAIN IS NO LONGER A DEPLOY.** Pushing runs CI and nothing else. Code reaches
users only when `infra/vn-node/eno-deploy.sh` is run ON THE BOX (162.4.176.233 since the
2026-09-20 migration; 162.4.176.208 is the retired box and everything on it is stale). That script
is the entire path: pull → build both editions → verify the marketplace bundle carries no
visa/itinerary routes → swap → health-check through Cloudflare → auto-rollback on failure.
If you pushed and did not run the deploy script, users do not have your change. After every push
read `gh run list --limit 3` — a red CI run pages nobody and blocks nothing.

⚠️ `git commit` and `git push` are both fine and expected — neither ships anything. What is
gated is running the deploy script, which is the owner's call per *"i will tell you when to
deploy"*. `/ship` step 5 is that step; a ship that stops at push has shipped nothing.

### Local review — load the `preview` skill before starting a server

⛔ The marketplace lives on :3000 only (`dev:vn` OR `preview:vn`, never both). ⛔ Wait for the
`── serving` line with a bounded wait (ship step 2 recipe), never for a 200. ⛔ `next dev` and
`npm run start` are not previews — verify on a `preview:vn` you started yourself (do not inherit
whatever already holds :3000), one edition at a time.

### After a deploy the owner DID authorise

⛔ **Purge Cloudflare by TAG** — `{"tags":["eno-html","eno-public"]}` on both zones — never
`purge_everything` (owner OK; licensing leak only), never by URL (cannot match the Worker's `__k=`
keys). `eno-deploy.sh` does it; without a purge a deploy is invisible for up to 6h. (What each tag
covers and what stays cached: `ship` skill step 6.)

## Shipping

**⛔⛔ THE 2026-07-29 OWNERSHIP RULE (removed 2026-08-05; see git history) IS REVERSED — READ THIS FIRST (owner, 2026-07-31).**
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
| visa · itinerary | ⛔ **not even a mention** — EXCEPT the e-Visa subcategory (below) | ✅ |
| e-Visa subcategory (`services/visa-legal`) | ✅ **since 2026-10-14** — third parties only, live after eno's licence check | ✅ same rule |
| PayPal / online visa payment | ⛔ | ⛔ **off since 2026-09-13** — owner: "no paypal … admin will resolve payment through chat"; the forum is an exact copy of eno.vn plus the e-Visa desk, and the visa application is photos + entry date |

⛔ **THE e-VISA SUBCATEGORY IS THE OWNER'S DELIBERATE EXCEPTION (2026-10-14) — DO NOT "FIX" IT BACK.** Owner: "also have an
evisa dedicated subcategory", then, asked twice with the licensing and scam risk and the forum's own /prohibited rule in
front of them: "Both sites, anyone posts" → "Anyone posts, live after check". So `services/visa-legal` is named "e-Visa"
on BOTH editions, ANY account may post there, and a listing from anyone but eno's own desk is stored unpublished until
an admin has seen the provider's licence (taxonomy.ts `licenceCheckHold`). This retired O-34's eno.vn relabel ("Legal &
permits") and O-34b's partner-only posting. What did NOT change: eno's OWN visa desk stays hidden from eno.vn
(`HIDDEN_DESK_OWNER_EMAILS` — eno itself still does not offer e-visa there), `/visa` + `/itinerary` stay forum-only,
no PayPal. Visa runs (tickets-travel/visa-runs) are still not offered for posting on eno.vn.

⛔ **THE LICENCE CHECK (owner, 2026-10-14) — `src/lib/licence-stamp.ts` is the map:**
- **Legal & permits (`services/legal-permits`) is held the same way** ("Check them too"); a keyword GUESS into either aisle counts as a pick. A Wanted ad is never filed in either.
- A non-desk listing in either aisle carries the provider's registered name and licence no. (`providerLegalName` / `providerLicenceNo`, `src/lib/provider-licence.ts`), printed on its page; any change of either, or of the aisle, re-holds it. Approval is Admin › Catalogue › Licence checks only (`scripts/licence-fill-seller.ts` enters values for a provider who cannot; it never approves).
- ⛔ The approval stamp lives in the **REPURPOSED** `Listing.verificationMethod` (+ `verifiedAt`). `serializeListing` must keep all four `verification*` fields null; only 'licence-approve' writes a stamp.
- ⛔ `verificationNotes = 'licence:held'` (`LICENCE_HELD_NOTE`) marks a row the licence check itself took down — the only kind 'licence-approve' publishes. Every licence hold writes it through `licenceHeldMark` (kept only for a row that was live, identity-parked or already marked); every publish of an existing row nulls it (tripwire: `compliance/public-state-writes.test.ts`), and so must a takedown that files no report (admin Unverify, moderation Unpublish).
- ⛔ Every existing-row publish — `verified: true` OR a status change back to `active` — ANDs `licenceClearedWhere` / `licenceClearedSql` (tripwire: `compliance/public-state-writes.test.ts`). `/api/cron/licence-holds` (00:00 ICT sharp) is the backstop.
- ⛔ `LICENCE_WHITELIST` (`src/lib/licence-whitelist.ts`, owner 2026-10-15: "whitelist vietkite") — VietKite is exempt in e-Visa ONLY, exactly like the desk (no values asked, never held, swept or revoked) and NEVER hidden (that is `HIDDEN_DESK_OWNER_EMAILS` — never a partner). By SELLER ID — the id is the identity: storefront ownership is claim-once (`ownerId: null` guards), so the id never names someone else, and a vanished id exempts nobody (fail closed). The module ships in the client bundle: no contact data in it.
- VietKite's grandfather (`LICENCE_GRANDFATHER`) is moot since the whitelist and ENDED 2026-10-15, with the /prohibited amendment the owner made immediate that day ("apply from now no need for warning" — no strip, no bell; the deploy carries `LEGAL_AMENDMENT_IMMEDIATE=2026-10-15`). It still ends on that record's in-force date — re-date both together.

⚠️ **This is a legal boundary, not a feature flag.** The failure mode is a LEAK: any place
eno.vn still shows, links to, describes, indexes, emails or serves one of those surfaces
means the licensed company is advertising a service it is not licensed for. ⚠️ **Visa
products are ordinary `Listing` rows sharing one `Seller` with the trip desk**, so browse,
search, rails, sitemap, JSON-LD and the Google/Meta feeds leak them unless filtered — that
is the likeliest thing to be missed, and it has nothing to do with the `/visa` pages.

The two apps **share one database**, which means a eno.vn user's thread can already contain
visa cards written by eno.forum. Degrade, never crash.

- The visa admin account is `support@eno.forum` — it owns the visa storefront and answers its threads (the deployed
  `src/lib/visa-shop.ts` `VISA_SHOP_OWNER_EMAIL`; the dormant forum copy agrees). `support@eno.vn` is only a mail
  redirect into it: no Profile row exists for it.
- ⛔ **The Browserbase hosted-prefill operator flow exists ONLY in the forum tree**
  (`apps/forum/src/lib/visa/hosted-prefill.ts`, `api/visa/admin/applications/[id]/prefill-session`,
  `api/visa/prefill/[token]` — file confirmed present). eno.vn has no Browserbase code at all, so
  deleting it removes a capability rather than a duplicate. Port it or have the owner confirm it is
  abandoned BEFORE deleting the forum visa tree.

⚠️ `apps/forum/**` STILL EXISTS IN THE REPO (33,884 files, measured 2026-08-05) even though its
Cloud Run service and build trigger were deleted. The owner's instruction was *"dont delete project
itself let it sit in git so we can host it later"* — so it is dormant source, not dead source: do
not delete it, and do not treat its presence as evidence that eno.forum is deployed. Never edit,
push or deploy from the retired `~/eno-forum` checkout or `Soolking-cyber/eno-forum`; do not
restore the retired `itinerary-resources` sync-pair.

`/ship` runs the shipping ritual — the gates, their order and the E2E_BASE trap are in the `ship` skill; load it rather than reconstructing them. Stop at the first red gate. If a push breaks prod, revert to the last known-good commit and pause — don't stack fix-on-fix.
