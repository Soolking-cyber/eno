# eno.vn backlog

The live task list. Replaces the retired cockpit board (history in `docs/cockpit-archive/`).
One agent works this top-down. **Status is only ever set from a MEASUREMENT, never from a diff.**

Updated 2026-07-27.

---

## ⚠️ Corrected — B1 was over-framed

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

## 🔴 Needs an owner decision

### B1 · A buyer with two visa threads jumps windows on "send the form again"
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

---

## P1

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

### B4 · The trip listing advertises a visa
The live trip-planning listing's only image is a red **"VIETNAM SINGLE ENTRY E-VISA / 1 HOUR EXPRESS"**
advert — misleading on an active, indexed listing, and it breaks the no-visa-wording-on-trip-surfaces
rule. **Blocked on the owner supplying a trip photo.**

### B5 · Visa and Itinerary threads are unlabelled in the inbox
`threadKind` shipped (T334) but nothing renders it. 6 of 23 live conversations share the identical
"eno Vietnam" counterpart name with no way to tell them apart. Needs `kind` on the
`/api/conversations` GET payload + a badge in `conversation-list.tsx` and the admin thread view.

---

## P3

### B6 · Itinerary geocoding stops at 8 stops per pass
Residual from the geocoding work: one production itinerary is stuck at 10/18 stops pinned. Long trips
stay permanently half-mapped.

---

## Done today (2026-07-27) — verified in prod, not just merged

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
