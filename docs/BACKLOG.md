# eno.vn backlog

The live task list. Replaces the retired cockpit board (history in `docs/cockpit-archive/`).
One agent works this top-down. **Status is only ever set from a MEASUREMENT, never from a diff.**

Updated 2026-07-28.

**Where things stand: 11 of 15 items shipped. Four remain, and only two are mine to do.**

| Phase | What it is | Items | Blocked on |
|---|---|---|---|
| **Phase 1** | Mine to do now | P1.1 orphan trip cards · P1.2 rolling bug hunt · B6 geocoder · B8 residual | nothing |
| **Phase 2** | Needs an owner decision | B15 build cache · P2.2 trip photo | you |
| **Phase 3** | Blocked upstream — do not start | B14 TypeScript 7 | typescript-eslint |

---

# PHASE 1 — mine to do now

### P1.1 · Three trip cards are sitting in e-Visa threads
Measured 2026-07-28: 3 rows of kind `trip_step`/`trip_quote`/`trip_status` live in conversations
anchored on a `visa-legal` listing — residue from the anchor corruption fixed in T337. They are
already **invisible and inert** (the thread page refuses to render trip cards when the server says
`kind === 'visa'`, and `advanceTripWizard` refuses to drive one), so there is no user-visible
symptom. What is left is the data. Low risk, low urgency, finite.

### P1.2 · Rolling bug hunt
Owner, 2026-07-28: *"continue fixing bugs"*. Not a ticket — a standing activity. Each pass:
reproduce from production data or logs, fix, pin with a test, verify in prod. Findings get their own
`P1.x` entry as they are confirmed, so this line never silently becomes the place work goes to die.

### B6 · ⚠️ MISDIAGNOSED — the stops are unmappable, not un-geocoded
Rewritten 2026-07-27 after measuring. The premise ("the 8-per-pass cap starves long trips") is
**false**. Dry-running `scripts/backfill-stop-coords.ts`: of 9 unmapped stops, exactly **1** could be
geocoded — it has been, so prod is now 19/27. The other 8 are AI-invented names no gazetteer will
ever contain: *"The Summer Experiment"*, *"Thao Dien Wellness Studio"*, *"Xuan Huong & Dong Khoi
Boutiques"*. More passes would fill none of them.

⚠️ A cron would make this WORSE, not better: `writeCache` stores hits only, so every pass re-queries
the same unmappable names forever, burning the shared `GEOCODE_DAILY_LIMIT` that genuinely new
places need. (Bounded — the limit is strict and fails closed — but wasted.)

**The real fix is upstream**: either constrain the generator to real, findable places, or record a
negative result so a name that cannot be found is not asked about again. Neither is a cron.

---

## 🔴 Open — the sharp outage's real fixes

Both exist because `sharp@0.35.3` shipped a container with no loadable native backend and took
`/api/listings` down for nine hours (`c86dc1f9` reverted it). **Neither goes near prod until it has
been verified against a real built image**, not just a green `npm run build` — a green build is
exactly what shipped the outage.

### B8 · ⚠️ MOSTLY CLOSED — a reloaded trip wizard is recoverable, not bricked
Original: `trip-cards.tsx` seeded `step` from the server row but `draft` from `EMPTY_DRAFT`, so a
reload returned the traveller to step 5 with empty answers and "Build my plan" 400d forever, *"with
no Back and no restart"*. Both halves of that are now false: the draft persists in `sessionStorage`
keyed by the card's message id, and the step rail is a **go-back control** — any answered step can be
tapped and re-answered locally without posting.

**What is left is narrow**: `sessionStorage` does not survive a new tab or another device, so a
traveller resuming elsewhere lands on step 5 with an empty draft. They can now walk back to step 1
and re-answer, so it is friction rather than a dead end. Promote it only if someone hits it.

---

## ⚠️ Corrected — B1 was over-framed (kept: the correction, not the open question)

I first wrote B1 as a product decision with three options. Measuring it collapsed the question, and
the correction is recorded rather than quietly edited away:

- The affected buyer is **the owner's own account** (`shanazar15071994@gmail.com`) — **1 of 5** desk
  buyers. No customer is affected.
- It **cannot recur**: `getOrCreateVisaThread` reuses any visa-anchored thread for a buyer
  (`findFirst`, newest first), and the hijack that created the second thread is fixed (T337). The
  duplicate thread was created `2026-07-26T14:00` — exactly when the hijack happened.

So this is **test-data cleanup, not design**. The only real argument for doing it: the owner tests on
this account, and an account that behaves unlike production keeps generating false bug reports —
which it already did once. Details kept below for context.

---

## ✅ Decided and done

---

# PHASE 2 — needs an owner decision

### B15 · ⛔ TRIED AND REVERTED 2026-07-28 — the npm ci cache works and does not pay
**Measured, three builds.** Baseline **313s** · cold cache-populate **414s** · warm **324s** —
eleven seconds SLOWER than no cache. Reverted in `d9d5d5b3`; the `eno-build-cache` repo is deleted.

The mechanism was fine: the warm build log shows `#13 [deps 6/6] RUN npm ci` → `CACHED`, so the
76.9s really was eliminated. It bought nothing, because **node_modules is 1.2 GB and it is the layer
being reused** — the builder stage COPYs it, so those bytes must land on the worker either way, and
pulling 1.2 GB from Artifact Registry costs about what `npm ci` cost to fetch and unpack from npm.
The work was moved, not removed. (`next build` also drifted 120.5s → 146.3s on the warm run.)

⚠️ **THE CEILING IS THE SIZE OF node_modules, so no tuning of the cache plumbing changes the
verdict** — dropping the explicit pull, or merging the two docker builds, still requires the same
1.2 GB to arrive. Recorded so the next person who costs `npm ci` at 77s does not re-derive it.

⚠️ One reviewer claim was WRONG and would have hidden this: that a single build tagging the FINAL
image with `BUILDKIT_INLINE_CACHE=1` caches all intermediate stages. It does not — inline cache
only describes layers present in the exported image, and the runner stage contains no node_modules,
so that cache could never hit. It would have looked simpler and silently done nothing.

What survives: the constraint that a cache in `asia-southeast1` would ALSO have cost ~$38/mo in
cross-continent egress, on top of losing.

### B15b · 🔴 THE REAL COST LEVER — Artifact Registry is 37.6 GB and unbounded
Found while doing B15. The `eno` repo holds **618 image versions / 37.6 GB** and had **no cleanup
policy at all** — it grew ~2 GB during this session alone, and 31 → 37.6 GB in three days. That is a
bigger and simpler saving than any build-minute tuning.

A policy is now **set in DRY-RUN** (`cleanupPolicyDryRun: true`, so it deletes nothing yet):
keep the 100 most recent versions, delete untagged older than 7d, delete anything older than 30d.
Sized from the real build rate — 50 builds in 7 days ≈ **7.1/day**, so 100 versions ≈ **14 days of
rollback depth** (an earlier draft used 40, which is only 5.6 days).

⚠️ **NEEDS AN OWNER DECISION TO ENABLE, because it deletes ~518 images irreversibly.** Cloud Run
revisions reference images by DIGEST: deleting one a revision still needs means that revision can no
longer scale up. The `Keep` rule protects the 100 newest, which covers any realistic rollback, but
the dry-run output should be read first — AR writes it to Cloud Logging within a day.

To enable once the dry run looks right:
```
gcloud artifacts repositories set-cleanup-policies eno --location=asia-southeast1 \
  --policy=<policy.json> --no-dry-run
```

### P2.2 · A photo for the trip-assistance listing
Owner, 2026-07-27: *"soon will be added"*. The trip anchor listing carries no image, so it renders
without one wherever listing cards appear. Nothing to build — it needs the picture.

---

# PHASE 3 — blocked upstream, do not start

### B14 · Move to TypeScript 7 — BLOCKED on typescript-eslint, not on us
TypeScript 7 (the native Go port) is GA and `latest` on npm. **Measured on this repo 2026-07-28 with
`typescript@7.0.2` actually installed, then reverted:**

| | TS 5.9.3 | TS 7.0.2 |
|---|---|---|
| `tsc --noEmit` | 6.3s | **3.5s** (~1.8x, not 10x — this typecheck is small) |
| `npm run lint` | passes | **CRASHES** |
| `tsc` errors | 0 | 14, all in one file |

The crash is structural, not a bug to wait out: TS 7's `package.json#exports["."]` is
`./lib/version.cjs` — the compiler API moved to `./unstable/*`. So
`@typescript-eslint/typescript-estree` dies with *"Cannot read properties of undefined (reading
'Cjs')"*, and our own `src/lib/visa-transition-drift.test.ts` (which parses two source files with the
AST **on purpose** — regex was refuted by both external reviewers, because it silently skips syntax
it does not understand) loses every API it uses.

⚠️ **THE TRADE TODAY IS BAD**: spend the lint gate — design-lint, the i18n contract, the Base UI
policy, the `createPortal` rule — to save under three seconds, against a ~120s `next build`. tsc is
not the bottleneck.

**The trigger is typescript-eslint admitting 7.x, not a TypeScript release.** Both blockers clear at
the same moment, so there is no point porting the drift test to an API TypeScript itself labels
unstable before then. Checkable in one command:

```
node scripts/check-ts7-readiness.mjs
```

⚠️ That script answers with real **semver**, not by pattern-matching the range string — the first cut
reported `>=5.0.0 <7.3.0` and `>=4.8.4 <8.0.0` as blocked when both admit 7.x. A detector that can
only ever say "no" would have parked this forever.

---

# SHIPPED — kept for the reasoning, not the status

Each of these records why it was done the way it was, and several record fixes that were tried and
REFUTED. That is the reason they are not deleted.

### B0 · ✅ FIXED 2026-07-27 — the saved-trip cap counted deleted trips
Found while mapping B2; it was **my own defect**, shipped in T334 this morning.

`DELETE /api/itineraries/[id]` is a **soft** delete (`status = 'archived'`, route.ts:33). Every other
read filtered archived out — the list, the single GET, the docx export — but `itineraryQuota()` did
not. With a cap of 3, a traveller who deleted three trips could never save another, and nothing on
screen would say why. `listItineraryDrafts()` had the visible half: a deleted trip stayed in the chat
picker and led to a page whose own GET 404s it.

⚠️ The T334 comment asserting *"DELETING FREES A SLOT for free"* was **false**, and the test that
should have caught it was a **tautology** — it simulated rows vanishing from a mock array, which a
soft delete never does. It passed throughout. Replaced with tests that assert the QUERY.

Caught before impact: **0 archived rows in prod**, because the delete control was never wired.
Fixing this was a prerequisite for shipping it.

### B1 · ✅ DONE 2026-07-27 — option (a), consolidated. Owner approved ("yeah do suggested") and `scripts/merge-visa-threads.ts` ran; the DB confirms it (the loser thread holds 0 messages and is hidden). ⚠️ The merge also nearly hid the buyer's ONLY visa thread — the survivor was chosen on message count without checking `buyerDeletedAt`; the script now clears it. Original framing below.

<details><summary>original</summary>

#### A buyer with two visa threads jumps windows on "send the form again"
**Owner, 2026-07-27 (on device):** *"inside chat, send the form again opens in new conversation window outside of the current chat window."*

**Measured, not inferred.** Buyer `562fa1d5` holds **3** desk threads:

| Thread | Anchored on | Active case |
|---|---|---|
| `cmrvk2xnl…` | E-Visa 1 Hour Express | `e77d1197` |
| `cms1v7yg5…` | E-Visa Multiple Entry Standard | `97756c48` |
| `cms2zz5zs…` | trip anchor | — (legitimate trip thread) |

`visa_applications.conversation_id` is **immutable by design**, so each case is welded to its own
thread. `POST /api/visa/applications/<id>/resume` returns `bound.conversationId` and the client
navigates there — so resuming a case from the *other* thread necessarily leaves the current window.
The route is behaving exactly as written.

**The real defect is upstream:** the design premise is *one* buyer↔desk visa conversation holding
several drafts (see the header comment in `resume/route.ts`). This buyer has two **only because of
the anchor corruption** — the hijacked thread fell out of `getOrCreateVisaThread`'s
`listingId IN visaListingIds` lookup, so a second one was created. The T337 route fix stops new
duplicates and the repair restored both anchors, but it deliberately **refused to merge**, because
choosing which of two message-bearing threads survives is a human decision. That decision is now due.

**Options:**
- **(a) Consolidate to one visa thread per buyer (recommended).** Matches the design premise and the
  reuse lookup. Needs a migration for the immutable `conversation_id`, and a rule that a buyer gets
  one visa thread regardless of which product they pick.
- **(b) Leave the threads, stop the jump.** Resume re-posts the card into the *current* thread. Cheaper,
  but two visa threads remain a permanent oddity and the "one active case" pointer still lies.
- **(c) Data-only.** Merge just this buyer's two threads; change no code. Fixes today, not tomorrow.

⚠️ Money/trust-adjacent and irreversible → external refutation at plan **and** diff before any write.

</details>

---

## P1

### B2 · ✅ SHIPPED 2026-07-27 (`7042f372`, CI green) — Consolidate "Itineraries" and "My Trips"
The naming was the small half. **6 of 9 prod trips had zero stops and a complete written plan the page
refused to render**, telling the traveller to "generate it again" via a button that redirected back to
the list. Now the plan renders, the assistance panel (the page's only revenue path) is no longer hidden
on two-thirds of trips, and one name is used everywhere in both languages.

<details><summary>original</summary>

**Owner, 2026-07-27:** *"make 1 root management place, itineraries should become my trip, and if user
selects saved trip in chat it should direct to my trips where user can see trips and edit."*

Half-renamed today, which is the whole complaint: nav + page title say **Itineraries**
(`dashboard-nav.tsx:115`, `dashboard/trips/page.tsx:11`, `trips-client.tsx:73,93,100,112`) while the
detail page's back-link already says **My trips** (`trip-detail-client.tsx:247`).

Scope: user-facing EN/VI copy and navigation **only**. The `Itinerary` model and `/api/itineraries/**`
stay — renaming them is a risky migration with no user value.
VI must land on **Chuyến đi** (trip), not **Lịch trình** (itinerary), consistently.

Also in scope: the chat drafts picker must land the traveller somewhere they can **edit**, not just read.

</details>

### B3 · ✅ SHIPPED 2026-07-27 (same commit) — A returning traveller has no way into the planner
"Plan a trip in chat" lived only in the `trips.length === 0` empty state, so the door shut the moment a
traveller saved their first trip. Hoisted beside the heading; `/itinerary`'s two CTAs re-aimed off the
dead redirect at the trip listing.

<details><summary>original</summary>

Found by audit, **overturning a "shipped" verdict.** `/dashboard/trips/plan` redirects to the trips
*list*, and the "Plan a trip in chat" link exists **only** in the `trips.length === 0` empty state — so
anyone who already saved a trip has zero path in, while `/itinerary`'s primary CTA still points at
that redirect. Same root cause as B4; fix together.

---

</details>

## P2 — next up

### B5 · ✅ SHIPPED 2026-07-27 (`056e76a4`, CI green) — Visa/Itinerary labels in the inbox
Both surfaces read the server's `threadKind` — one label source, never a second rule client-side.
Measured: 7 of 24 live threads (4 Visa, 3 Trip) became distinguishable; they all showed the identical
"eno Vietnam" before, because the two desks are one Seller row. `'listing'` gets no badge (nothing to
disambiguate) and `kind` is optional on the type, since the inbox hydrates from a localStorage cache
written before the field existed — absent means no label, not a default.

<details><summary>original</summary>

`threadKind` shipped (T334) but nothing renders it. 6 of 23 live conversations share the identical
"eno Vietnam" counterpart name with no way to tell them apart. Needs `kind` on the
`/api/conversations` GET payload + a badge in `conversation-list.tsx` and the admin thread view.

---

</details>

## P3

### B7 · ✅ CLOSED WITHOUT THE MIGRATION — the republish branch was deleted instead
The `heldReason` column below was the plan; measuring made it unnecessary. **No create path produces
a below-the-bar listing any more** — `createListingCore` and `bulk.ts:168` both insert
`verified: true`, `sync` never writes the column, and a publish violation THROWS rather than saving a
held row. So every `verified === false` in the database arrived through one of six *takedown* paths,
and the branch had no benign case left to serve. It is gone, and
`src/lib/core/listings.republish.test.ts` pins all six paths as a counted list. An operator restores
a pulled listing with the admin `verify` action, which is the only escape hatch and is meant to be a
human.

<details><summary>the migration that is no longer needed</summary>

**Needs one additive column** on `Listing` recording *why* it is unverified
(`heldReason: 'photos' | 'admin'`), set by the takedown paths and checked by the republish branch.
Small migration via the documented schema flow.

</details>

⚠️ **Two plausible fixes were tried and rejected with evidence — do not re-propose them:**
- *Reuse the dormant `verifiedBy` column.* agy: conflates "who approved" with "who removed", and
  enforcement's bulk reinstates (`enforcement.ts:158,245`) never clear it, so a reinstated listing
  would carry a permanent takedown marker.
- *Treat "zero photos" as the photo-hold signature.* Refuted by measurement: the one held listing
  in production carries **1 image** while goods require 3, so real photo-holds do have photos.

The gap is pinned in `src/lib/core/listings.republish.test.ts` so it cannot be quietly forgotten.

### B10 · ✅ SHIPPED 2026-07-28 (`886c833a`) — the visa wizard's go-back rail
The 5-dot rail is now the control: steps already reached are tappable, the card re-renders that
step's questions pre-filled from the applicant's own case, and saving goes through the same endpoint
the live step uses.

**Server**: the act route stopped hardcoding `step: meta.step` and accepts an optional step clamped
to `1 <= step <= meta.step` (the CARD's step). No new capability — the writable set becomes the union
of steps already reached, which is exactly what the applicant could write while passing through them.
Ownership, `EDITABLE_STATUSES`, whole-payload zod revalidation, the CAS on `updated_at` and the audit
event are all untouched.

⚠️ **What makes it safe after a purchase is the STATUS gate, not the bound.** `entryType` (single vs
multiple entry) is in step 4 and must match the product paid for — but payment takes the case out of
`EDITABLE_STATUSES`, so no step can be rewritten underneath a purchase. Pinned by a test that flips
the status to `submitted` and asserts `application_locked`.

⚠️ **Advancing verbs belong to the live step only.** Acknowledge/Skip vanish while an earlier step is
on screen, and `submitEdit`'s "nothing changed → acknowledge" path just closes instead — otherwise
"let me check what I put" silently becomes "confirm and continue".

---

## Done 2026-07-28 — verified in prod, not just merged

- **Dependency patch + a build-time guard** (`d7e1c166`, CI green, revision `eno-vn-00588-f49`).
  `npm audit fix` took production advisories **9 → 3**; the three left are `next`+`postcss` (npm's
  only remedy is a downgrade to next@14) and `sharp` (B13). ⚠️ It moved **125 packages**, not 5 —
  everything inside its existing range, incl. next 16.2.11→16.2.12 and prisma 7.8.0→7.9.1. The
  Dockerfile now proves sharp works inside the real image before it ships (B11a).
- **The trip planner's button now produces the planner** (`e36e5334`, CI green, revision
  `eno-vn-00586-bkk`, verified by grepping the live PDP bundle). Owner: *"when i click plan my trip it
  just sends message instead of giving me the form"* — measured: an ACTIVE step-1 wizard card had sat
  first in a thirteen-message thread since 09:01Z, and the launcher chip hid itself precisely because
  a wizard was running, so the card was live, off screen, and unreachable. The chip no longer hides
  (it becomes "Continue planning" and scrolls the card back into view); "is a wizard running" is read
  off the rendered message list instead of a separate fetch that could go stale; and the plan CTA
  posts nothing at all, opening the thread with `?plan=1` so the wizard opens with it. Trip cards also
  stopped rendering inside e-Visa threads, where pre-anchor-fix residue still puts one.
- **Dependency/security patch** (`d861fab4`, CI green) — `next 16.2.10 → 16.2.11` (nine advisories,
  incl. cache confusion of response bodies on an ISR-heavy app) and `sharp 0.34.5 → 0.35.3` (four
  libvips CVEs). ⚠️ The sharp bump broke the **build** while all 1434 tests passed — nothing imports
  `visa/image-normalization.ts`. A green suite does not validate a dependency bump.

---

## Done 2026-07-27 — verified in prod, not just merged

- **Visa/trip thread collision (T337)** — one desk, two thread kinds. Was a live 500 (12×/24h, mostly
  from the iOS app) *and* the duplicate-chat bug. Zero 500s since deploy.
- **Anchor repair** — 2 hijacked visa threads re-anchored to their own products; direction verified
  against message history (42-vs-1 and 27-vs-2 visa/trip cards), rollback at
  `~/eno-visa-anchor-rollback-2026-07-27.sql`.
- **Native sign-in (T336)** — ⚠️ the Turnstile-in-WebView theory is **disproven by measurement**, not
  assumption: `EnoNativeApp/1` reached `/api/auth/email-link` with **200** at 09:03:26Z, the first such
  request ever. Owner confirmed the 8-digit code and visa application both work in the app.
- Sign-in error retraction (T331) · trip withdrawal + binding 10% fee (T333) · `threadKind` + itinerary
  cap (T334) · e-Visa SEO cluster (T332) · trip drafts chip (T335b).
- **Closed after audit:** the chat trip wizard, map attribution (no licence exposure — credits are live),
  Google Maps directions, and the Turnstile outage — all verified as behaviour in prod.

### B11a · ✅ SHIPPED 2026-07-28 (`d7e1c166`) — the image now PROVES sharp works before it ships
A guard in the Dockerfile's runner stage encodes a 1×1 PNG and fails the build if it cannot. It runs
**after `USER nextjs`** (as root it would pass on files the server may not be able to read — the
exact false green it exists to stop), and it exercises libvips rather than just resolving the module.
Confirmed firing in Cloud Build: `sharp OK 0.34.5`. Both branches were tested first — sharp absent →
exit 1, present → exit 0.

⚠️ **This is why a local `docker run` was NOT the acceptance test**: an arm64 laptop resolves the
darwin binaries and passes while the deployed linux-x64 image is broken. The check has to run on the
build platform, inside the image.

### B11b · ✅ SHIPPED 2026-07-28 (`0ae38ee0`) — the runtime takes its binaries from `npm ci`
`COPY --from=deps /app/node_modules/@img ./node_modules/@img` in the runner stage. Additive and
idempotent: identical to the traced set when the tracer is right, load-bearing when it is not.

### B12 · ✅ SHIPPED 2026-07-28 (`0ae38ee0`) — a media dependency can no longer kill browse
`lib/sharp-lazy.ts` is now the only way this app loads sharp. `ai-moderation`, `image-hash` and
`core/media` all went lazy; route files that genuinely need sharp still import it directly, which is
the point — the blast radius becomes that one route.

**Proven by reproducing the outage**, not by argument. Standalone bundle copied OUTSIDE the repo
(⚠️ Node walks UP for `node_modules`, so the first attempt resolved sharp from the repo root and
passed meaninglessly), `@img` deleted so sharp genuinely throws:

| | before (2026-07-27, prod) | after |
|---|---|---|
| `/api/listings` | **500** × 320 | **200** |
| `/` | 500 | **200** |
| `/api/brands/[slug]/logo` | 500 | 500 — correctly scoped |

Pinned by `src/lib/sharp-lazy.test.ts`.

### B13 · ✅ SHIPPED 2026-07-28 (`0ae38ee0`) — libvips CVEs closed, guard confirmed on linux
sharp back to **0.35.3**; CVE-2026-33327/33328/35590/35591 closed. The build guard printed
`sharp OK — encoded 90 bytes, PNG magic PNG` on linux/amd64 before the image was allowed to deploy.

⚠️ **The guard would itself have broken on this upgrade** and that is worth remembering: it printed
`require('sharp/package.json').version`, which 0.35 does not expose through `exports`
(ERR_PACKAGE_PATH_NOT_EXPORTED) — so the CHECK would have failed a healthy image. A guard that cries
wolf is worse than no guard. It reports the bytes it encoded now.

⚠️ **`npm audit` still lists sharp, and it is NOT ours.** The remaining node is
`node_modules/next/node_modules/sharp@0.34.5` — Next's own vendored copy for `/_next/image`, whose
only offered fix is downgrading to next@14. Our direct dependency is 0.35.3. Mitigating: uploads are
re-encoded by our patched sharp before anything reaches the optimizer, and `remotePatterns` admits
only our own bucket. Nothing to do until upstream ships.

⚠️ **THE INTEROP SHAPE DIFFERS BETWEEN 0.34 AND 0.35** and both spellings were written wrong here
hours apart. 0.34 is CommonJS (`export = sharp`): the TYPE is the callable, no `.default`. 0.35 is a
real ES module: the type is the NAMESPACE, the callable is its `default`. Wrong way round gives
"This expression is not callable" at seven call sites, or "Property 'default' does not exist".

---

## Open — asked for, not yet built
