// THE TRADE LOOP — the PURE rules for a sale the marketplace can actually see.
//
// WHY THIS EXISTS. eno holds no money: every trade completes off-platform, so unless
// somebody TELLS us a sale happened, the marketplace observes nothing. That single gap
// starves two things at once — the trust ladder has no transactions to count, and price
// guidance is computed from what sellers ASKED rather than what buyers PAID. Closing the
// loop is what unlocks both, and it costs nothing: no escrow, no fees, no money held.
// The free-posting, no-commission promise is untouched by every line in this file.
//
// THE FLOW (spec):
//   · The seller taps "Mark as sold" and picks the buyer FROM THE PEOPLE WHO MESSAGED —
//     one tap, no search box. "Someone not on eno" is a first-class option.
//   · The buyer gets ONE notification — "Minh says you bought the Honda Vision for
//     11.200.000 đ. Confirm so it counts for both of you." → Yes / No.
//   · ONLY after BOTH sides have spoken does the review prompt appear.
//
// ⚠️ ONE ASYMMETRY IS THE WHOLE POINT AND MUST NOT BE SMOOTHED AWAY LATER.
// `soldChannel` / `soldToProfileId` / `soldAt` are the SELLER'S UNILATERAL CLAIM. One
// person's word is not a trade, and a seller who can mint trust by naming a friend has
// simply moved the fraud one step earlier. `saleConfirmedAt` is the BUYER'S OWN ANSWER,
// and it is the only thing trust may read. An off-platform sale is a REAL sale — the
// listing is gone, the seller is done — it just cannot count toward trust, because there
// is no second party for us to ask. Refusing to record it would be worse: sellers would
// stop marking things sold at all and we would lose the inventory signal too.
//
// PURITY CONTRACT: no Prisma, no `server-only`, no I/O, no `new Date()` without an
// argument. Every function takes its facts and its clock as arguments so the whole
// machine is unit-testable (src/lib/trade-loop.test.ts) and safely importable from a
// client component. Callers do the reads and the writes; this file decides.
//
// ── THE FIVE PATHS THAT CAN ALREADY WRITE status='sold' (inventoried 2026-08-11) ────
// Only the first attributes a buyer today. The rest set the status and nothing else,
// which is precisely why an unattributed sale must stay a legal, non-counting state.
//   1. POST /api/listings/[id]/sold          — the native Mark-sold confirm sheet. The ONLY
//      attributing path: passes { channel, buyerProfileId, platform } to setStatusCore and
//      already validates the buyer against this seller's conversations. → gains salePrice
//      and the confirmation prompt; this is where markSoldPatch() belongs.
//   2. POST /api/listings/[id]/status        — the web dashboard row menu + the chat
//      quick-reply chip. Sends { status: 'sold' } with NO attribution.
//      → must now route through the same picker, or every web sale stays invisible.
//   3. POST /api/v1/listings/[id]/status + src/lib/core/sync.ts — the partner API (single
//      status write, and the bulk sync). A shop's own system says "sold"; there is no buyer
//      to name. → stays unattributed by design; treat as an off-platform sale.
//   4. src/lib/mcp/tools.ts (listing status tool)  — same shape as (3).
//   5. POST /api/listings/availability       — the daily "still available?" review, which
//      bulk-updates with db.listing.updateMany({ data: { status: 'sold' } }) and so bypasses
//      setStatusCore entirely (no cache purge, no de-index, no webhook — a pre-existing bug
//      worth its own fix). → each id ticked here should raise the buyer picker.
// setStatusCore's `soldMeta === undefined` branch deliberately leaves existing sold* alone
// so a re-sync cannot erase attribution. That branch must keep that behaviour for sale*.
//
// ⚠️ TWO OBLIGATIONS THIS PURE MODULE CANNOT ENFORCE, both of which belong to the caller:
//   · REACTIVATION CLEARS THE WHOLE CLUSTER. setStatusCore/confirmCore already null the sold*
//     columns when a listing goes back to 'active'; they must null sale* too, INCLUDING
//     saleBuyerHistory. A relisted item is genuinely a new sale, and leaving the decline
//     memory behind would permanently bar a buyer who declined a year ago.
//   · THE BUYER'S ANSWER MUST BE A CONDITIONAL WRITE. See buyerResponsePatch.
//   · THE SWEEP MUST BE EDITION-SCOPED. Visa and itinerary products are ORDINARY Listing rows
//     (see the desk notes), and nothing in these pure rules can tell them apart — a naive cron
//     would send "confirm you bought <visa service> for X đ". Scope the query with the existing
//     edition helpers; this module deliberately does not import them, because a rule about who
//     may confirm a sale is not the right place to encode which domain serves it.

import { DAY_MS } from './trust-math'

const HOUR_MS = 3_600_000

export const SOLD_CHANNELS = ['eno', 'external'] as const
export type SoldChannel = (typeof SOLD_CHANNELS)[number]

export const TRADE_LOOP = {
  /**
   * How long after the sale the buyer may still answer. Past this the prompt closes
   * itself — an unanswered question is not evidence, and a two-month-old "did you buy
   * this?" is noise the buyer has no way to answer honestly.
   */
  CONFIRM_WINDOW_DAYS: 14,
  /**
   * Minimum gap between asks. ⚠️ THIS PAIR IS THE "NOT FOREVER" PROOF, so read it as
   * arithmetic rather than as two independent knobs: with a 14-day window and a 5-day
   * cooldown the buyer is asked at t=0, t≈5d and t≈10d and then never again — THREE
   * asks, maximum, without storing an attempt counter. Change either number and
   * recompute that sentence.
   */
  PROMPT_COOLDOWN_HOURS: 120,
  /**
   * How many notifications the MARK-SOLD path may send one buyer about one listing, ever.
   *
   * ⚠️ THIS REPLACED A COOLDOWN ON THAT PATH, AND THE REASON MATTERS. Gating a price
   * correction on the reminder cooldown looked right and set a trap both external reviewers
   * found independently: the edit updated `salePrice` while the buyer's recorded question kept
   * the OLD number, so the two diverged and the buyer's answer could never satisfy a
   * price-bound conditional write — a prompt they could see, and never successfully answer,
   * for five days. A counted budget lets the correction re-ask AT ONCE (no divergence, ever)
   * while still bounding the lever. Worst case per buyer per listing: this many seller-driven
   * asks plus the three cron reminders.
   */
  MAX_MARK_SOLD_ASKS: 3,
  /** Matches the existing sold route's slice(0, 60) on the free-text platform name. */
  MAX_PLATFORM_LEN: 60,
  /**
   * Sanity bounds on the agreed price, as a fraction/multiple of the asking price.
   * Not an anti-fraud control (a confirmed price was agreed by the buyer) — a
   * fat-finger control, so 11.200.000 typed as 11.200.000.000 cannot poison a price
   * band. Haggling below ask is normal, which is why the floor is generous.
   */
  SALE_PRICE_MIN_FRACTION: 0.05,
  SALE_PRICE_MAX_MULTIPLE: 2,
  /**
   * Absolute ceiling in VND, ~1.000 tỷ đ. ⚠️ NOT redundant with the ratio bounds: those are
   * skipped when there is no usable asking price (a listing priced 0, or a caller that does
   * not pass one), and a reviewer pointed out that left the column accepting any finite
   * positive number — including a typo that would then reach price guidance. This is the
   * floor under that gap, not a second opinion about a sane price.
   */
  SALE_PRICE_ABS_MAX: 1_000_000_000_000,
} as const

/**
 * The sale columns of a Listing, as plain values. Shaped so a caller can pass a Prisma
 * row straight in, but declared structurally so this module never imports Prisma.
 */
export type SaleFacts = {
  status: string
  /**
   * Listing.complianceStatus. ⚠️ NEEDED HERE, not just at mark-sold time: an item can be sold
   * and THEN taken down by authority order, and without this the buyer could still answer the
   * pending prompt and mint trust — plus a price for the guidance band — for goods the platform
   * was ordered to remove.
   */
  complianceStatus: string | null
  soldChannel: string | null
  soldToProfileId: string | null
  soldAt: Date | null
  salePrice: number | null
  saleConfirmedAt: Date | null
  saleDeclinedAt: Date | null
  /** Compact JSON, one entry per buyer ever asked. Survives re-attribution. See parseBuyerHistory. */
  saleBuyerHistory: string | null
  saleConfirmPromptedAt: Date | null
}

/**
 * · unsold        — not sold (or un-sold again by a reactivation).
 * · unattributed  — sold with nobody named. Paths 2–5 above land here. A real sale;
 *                   invisible to trust; the seller can still upgrade it by naming a buyer.
 * · off_platform  — "someone not on eno". A real sale, deliberately never countable.
 * · awaiting_buyer— an eno buyer was named and has not answered yet.
 * · confirmed     — the buyer said yes. THE ONLY STATE TRUST MAY COUNT.
 * · declined      — the buyer said no. Terminal-ish (see canMarkSold's decline rule).
 */
export const SALE_STATES = ['unsold', 'unattributed', 'off_platform', 'awaiting_buyer', 'confirmed', 'declined'] as const
export type SaleState = (typeof SALE_STATES)[number]

/**
 * Reason slugs, never prose — the client maps these to tr(en, vi) copy, so wording can
 * improve without a data migration and the server never ships English to a Vietnamese
 * user. Same convention as ENFORCEMENT_REASON in enforcement-machine.ts.
 */
export type DenyReason =
  | 'not_seller' // the actor does not own this storefront
  | 'listing_unavailable' // taken down by authority order — a takedown is not a sale
  | 'invalid_channel' // channel was neither 'eno' nor 'external' nor null
  | 'no_buyer_named' // channel 'eno' without a buyer
  | 'buyer_not_in_conversations' // named someone who never messaged this SELLER (see canNameBuyer)
  | 'buyer_is_seller' // naming yourself
  | 'buyer_declined' // re-naming a buyer who already said no on this listing, ever
  | 'invalid_price' // a price was supplied and it is not a plausible number
  | 'not_sold' // responding to a listing that is not sold
  | 'seller_cannot_confirm' // the seller may not confirm their own sale
  | 'not_the_buyer' // some third party trying to answer
  | 'already_confirmed'
  | 'already_declined'
  | 'confirm_window_closed'
  // The price changed but this buyer's ask budget is spent. ⚠️ RECOVERY, because this is
  // otherwise a dead end the UI can walk into: the mark-sold sheet must prefill
  // confirmPromptPrice() — the number the buyer was actually shown — not the raw salePrice
  // column, which an intervening external mark may have cleared. Re-submitting the shown price
  // is `sameQuestion` and always succeeds. Otherwise: name a different buyer, or relist.
  | 'ask_budget_exhausted'
  | 'not_confirmed' // review prompt asked for before both sides spoke

export type Decision = { ok: true } | { ok: false; reason: DenyReason }

const ALLOW = { ok: true } as const
// Generic in the reason so one refusal value satisfies BOTH `Decision` and the wider
// result unions below — otherwise every `return deny(...)` needs a cast, and a cast is
// where a wrong shape hides.
const deny = <R extends DenyReason>(reason: R) => ({ ok: false as const, reason })

// ── The durable per-buyer memory ──────────────────────────────────────────────────
//
// ⚠️ EVERY OTHER sale* COLUMN DESCRIBES THE **CURRENT** ATTRIBUTION AND IS WIPED WHEN THE
// SELLER RE-ATTRIBUTES. That is correct for them and fatal for a rule that must hold across
// re-attributions, which is why this exists. Two rounds of external review broke the earlier
// per-listing versions, and both breaks were reproduced by measurement before being fixed:
//   · "who declined" as a single id → A declines, seller attributes to B, B declines and
//     OVERWRITES A, so A is nameable again with a fresh window and three fresh asks.
//   · the prompt clock guarded by `soldChannel === 'eno'` → mark external, then mark the same
//     buyer again; both clocks restamp. A probe toggling once a day sent a silent buyer
//     300 NOTIFICATIONS OVER 300 DAYS, against a documented maximum of three.
// A record per BUYER survives both round-trips. Keep it that way.

/**
 * One buyer ever asked about this listing.
 *  · `askedAt`    — the FIRST ask. Never moved, so it anchors the one confirm window this
 *                   buyer will ever get for this listing.
 *  · `askedPrice` — the number they were last asked about. ⚠️ THE PRICE IS PART OF THE
 *                   QUESTION: re-posing the SAME price must not re-notify (that is the
 *                   harassment guard), while a DIFFERENT price must, or the seller edits the
 *                   figure under a notification the buyer already has and gets a confirmation
 *                   for a number nobody agreed to. Absent on entries written before this field.
 *  · `asks`       — how many notifications the MARK-SOLD path has sent this buyer. The budget
 *                   that lets a price correction re-ask immediately without becoming a spam
 *                   lever. Absent on entries written before this field (treated as 0).
 *  · `declinedAt` — they said no. Permanent; per-buyer so a second decliner cannot erase a first.
 */
export type BuyerHistoryEntry = { id: string; askedAt: number; askedPrice?: number | null; asks?: number; declinedAt?: number }

/**
 * Bounded so a seller with a huge inbox cannot grow one listing row without limit.
 *
 * ⚠️ KNOWN RESIDUAL, STATED RATHER THAN HIDDEN: eviction protects declines first, but a seller
 * who names more than this many DISTINCT buyers on ONE listing can push an older silent buyer's
 * entry off the end, and re-naming that buyer then looks like a first ask — a fresh window and
 * up to three more prompts. The attack costs 50 real conversation partners per recycled ask
 * (naming a buyer requires an actual thread), which is why a fixed cap is still the right
 * trade against an unbounded TEXT column on a table read by every feed query. The route-level
 * rate limit on mark-sold is the intended second line; raise this number if real sellers ever
 * legitimately approach it.
 */
export const MAX_BUYER_HISTORY = 50

/**
 * Parse the stored blob. FAIL-SAFE IN ONE DIRECTION ONLY: malformed JSON yields an empty
 * history, which forgets declines rather than inventing them — the failure that annoys a
 * seller, not the one that re-prompts a buyer who said no. Any entry missing an id or a
 * finite askedAt is dropped rather than defaulted, so a half-written row cannot masquerade
 * as a real ask.
 */
export function parseBuyerHistory(raw: string | null): BuyerHistoryEntry[] {
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const out: BuyerHistoryEntry[] = []
  for (const row of parsed) {
    if (!row || typeof row !== 'object') continue
    const r = row as { i?: unknown; a?: unknown; p?: unknown; n?: unknown; d?: unknown }
    if (typeof r.i !== 'string' || !r.i) continue
    if (typeof r.a !== 'number' || !Number.isFinite(r.a)) continue
    const entry: BuyerHistoryEntry = { id: r.i, askedAt: r.a }
    if (r.p === null || (typeof r.p === 'number' && Number.isFinite(r.p))) entry.askedPrice = r.p
    if (typeof r.n === 'number' && Number.isFinite(r.n) && r.n > 0) entry.asks = r.n
    if (typeof r.d === 'number' && Number.isFinite(r.d)) entry.declinedAt = r.d
    out.push(entry)
  }
  return out
}

/**
 * The stored form. Short keys because this rides on every listing row.
 *
 * ⚠️ THE CAP EVICTS ONLY BUYERS WHO NEVER DECLINED. A plain `slice(-50)` made
 * `buyer_declined` bypassable: a seller with 51 conversation partners names fifty of them in
 * turn, the first decliner falls off the front, and re-naming them passes with a fresh window
 * and fresh prompts. Measured against that draft — `canNameBuyer` returned ok. Declines are
 * the durable fact this column exists for, so they are kept first and the cap is spent on the
 * merely-asked.
 */
export function serializeBuyerHistory(entries: readonly BuyerHistoryEntry[]): string | null {
  if (entries.length === 0) return null
  let kept: readonly BuyerHistoryEntry[] = entries
  if (entries.length > MAX_BUYER_HISTORY) {
    const declined = entries.filter((e) => e.declinedAt !== undefined)
    const asked = entries.filter((e) => e.declinedAt === undefined)
    // Newest declines win if even they overflow — 50 refusals on one listing is not a real shape.
    // ⚠️ RESERVE A SLOT FOR THE ASKED SIDE. With the cap filled by declines, `remaining` hit 0
    // and EVERY asked entry was dropped — including the buyer just named, appended last. On the
    // next read `prior` was undefined, so the window anchor fell back to soldAt (which every
    // mark-sold restamps) and `asks` reset to 0: the confirm window never closed and the whole
    // 336-asks vector re-opened. Measured: the current buyer's entry came back `undefined`.
    const keptDeclined = declined.slice(-(MAX_BUYER_HISTORY - 1))
    // ⚠️ `slice(-remaining)` IS WRONG WHEN remaining IS 0 — `-0 === 0`, so `slice(-0)` returns
    // the WHOLE array and the cap silently stops applying at exactly the point it matters
    // (50 declines on one listing → unbounded growth of a TEXT column read on every listing
    // query). Measured: [1,2,3].slice(-0) → [1,2,3]. Spell the empty case out.
    const remaining = MAX_BUYER_HISTORY - keptDeclined.length
    kept = [...keptDeclined, ...(remaining > 0 ? asked.slice(-remaining) : [])]
  }
  return JSON.stringify(
    kept.map((e) => {
      const out: { i: string; a: number; p?: number | null; n?: number; d?: number } = { i: e.id, a: e.askedAt }
      if (e.askedPrice !== undefined) out.p = e.askedPrice
      if (e.asks !== undefined) out.n = e.asks
      if (e.declinedAt !== undefined) out.d = e.declinedAt
      return out
    }),
  )
}

/** The entry for a buyer, or undefined if this listing has never asked them. */
export function buyerHistoryEntry(raw: string | null, buyerProfileId: string): BuyerHistoryEntry | undefined {
  return parseBuyerHistory(raw).find((e) => e.id === buyerProfileId)
}

// ── State ─────────────────────────────────────────────────────────────────────────

/**
 * The one place that reads the columns and says what state the sale is in. Never
 * re-derive this at a call site: three of the six states look identical if you only
 * check `status === 'sold'`.
 *
 * ⚠️ If BOTH confirmed and declined are somehow stamped (only reachable by a direct DB
 * write — the transitions below make it impossible), this reports DECLINED. The
 * conservative reading of contradictory evidence is the one that does NOT mint trust.
 */
export function saleState(facts: SaleFacts): SaleState {
  if (facts.status !== 'sold') return 'unsold'
  // ⚠️ 'declined' REQUIRES A NAMED ENO BUYER for the same reason 'confirmed' does below: a
  // stamp left behind by a direct write must not label a sale that has no counterparty. A
  // decline is always ABOUT somebody.
  if (facts.saleDeclinedAt && facts.soldChannel === 'eno' && facts.soldToProfileId) return 'declined'
  // ⚠️ 'confirmed' REQUIRES A NAMED ENO BUYER, not merely a confirmation stamp. The
  // transitions below cannot produce a confirmed external/unattributed row, so this looks
  // unreachable — which is exactly why it is here. It is the last line of defence for a
  // stamp that arrived some other way (a backfill script, a hand-written UPDATE, a future
  // caller that writes the column without asking canRespondToSale), and the failure mode it
  // blocks is "an off-platform sale silently starts counting toward trust".
  const namedEnoBuyer = facts.soldChannel === 'eno' && !!facts.soldToProfileId
  if (facts.saleConfirmedAt && namedEnoBuyer) return 'confirmed'
  if (facts.soldChannel === 'external') return 'off_platform'
  if (namedEnoBuyer) return 'awaiting_buyer'
  return 'unattributed'
}

// ── Marking sold ──────────────────────────────────────────────────────────────────

export type MarkSoldInput = {
  /** 'eno' = a buyer who messaged · 'external' = someone not on eno · null = no attribution. */
  channel: string | null
  buyerProfileId?: string | null
  /** Free text marketplace name, external channel only ("Facebook", "Chợ Tốt", "in person"). */
  platform?: string | null
  /** The agreed price in VND. Absent/null = the seller declined to say, which is allowed. */
  salePrice?: number | null
}

export type MarkSoldContext = {
  /** Who is acting (a Profile id), or null for a guest. */
  actorProfileId: string | null
  /** Profile that owns the storefront (Seller.ownerId). */
  sellerProfileId: string | null
  /** Listing.complianceStatus — 'taken_down' is a separate terminal state, not a sale. */
  complianceStatus?: string | null
  /** Listing.price, for the fat-finger bounds on salePrice. */
  askingPrice: number | null
  /** Profile ids that have a conversation with this seller. The picker's source of truth. */
  conversationBuyerProfileIds: readonly string[]
  /** Current sale columns — needed for the decline rule below. */
  facts: SaleFacts
  now: Date
}

/**
 * The exact column values to write. Returned as data rather than applied, so the caller
 * owns the transaction and this stays pure.
 *
 * ⚠️ saleConfirmedAt / saleDeclinedAt are ALWAYS null here, including on a re-attribution.
 * Re-marking a sale is a NEW claim about a NEW counterparty; carrying the old buyer's
 * answer across to a different person would be inventing consent.
 *
 * ⚠️ TWO EXCEPTIONS, BOTH LOAD-BEARING:
 *  · saleBuyerHistory is never blanked — it is the memory that makes the decline and
 *    anti-harassment rules survive a re-attribution (see canNameBuyer).
 *  · saleConfirmedAt survives an EXACT no-op re-tap (same buyer, same price), because a
 *    seller double-tapping Mark-sold must not silently destroy a confirmation. Any real
 *    change to a confirmed sale is refused outright rather than clearing it — otherwise
 *    re-marking is a one-tap way to erase an incoming review.
 * Callers must write every field rather than omitting it, so the invariant is visible at the
 * call site instead of relying on Prisma's leave-alone semantics for absent keys.
 */
export type MarkSoldPatch = {
  status: 'sold'
  soldChannel: SoldChannel | null
  soldToProfileId: string | null
  soldPlatform: string | null
  soldAt: Date
  salePrice: number | null
  /** Null on any real change; preserved only on an exact no-op re-tap. */
  saleConfirmedAt: Date | null
  saleDeclinedAt: null
  /** Carried through, plus an entry for a buyer being asked for the first time. */
  saleBuyerHistory: string | null
  /** Stamped now when an eno buyer will be asked; null when there is nobody to ask. */
  saleConfirmPromptedAt: Date | null
}

/** Who may mark a listing sold: the storefront owner, and nobody else. */
export function canMarkSold(
  ctx: Pick<MarkSoldContext, 'actorProfileId' | 'sellerProfileId' | 'complianceStatus'> & { facts?: Pick<SaleFacts, 'complianceStatus'> },
): Decision {
  if (!ctx.actorProfileId || !ctx.sellerProfileId || ctx.actorProfileId !== ctx.sellerProfileId) return deny('not_seller')
  // A listing pulled by authority order is NOT sold and must never render the sold page —
  // that would tell buyers the item found a buyer, which is false. Mirrors the schema note
  // on complianceStatus.
  //
  // ⚠️ FALLS BACK TO THE FACTS, and that is not belt-and-braces. `ctx.complianceStatus` is an
  // optional top-level convenience; a caller that passes the listing row as `facts` and simply
  // does not duplicate the field would otherwise sail past this check and mark a taken-down
  // listing sold. Read whichever one the caller supplied.
  const compliance = ctx.complianceStatus ?? ctx.facts?.complianceStatus ?? null
  if (compliance === 'taken_down') return deny('listing_unavailable')
  return ALLOW
}

/**
 * Whether the buyer the seller picked may be named. Separated out because the picker UI
 * needs the same answer BEFORE the seller taps anything.
 */
export function canNameBuyer(
  buyerProfileId: string,
  ctx: Pick<MarkSoldContext, 'sellerProfileId' | 'conversationBuyerProfileIds' | 'facts'>,
): Decision {
  // ⚠️ AN UNRESOLVED SELLER REFUSES, it does not skip the check — the same fail-open pattern
  // that was deleted from canRespondToSale. This function is exported for the picker, so a
  // picker that cannot resolve the storefront owner would otherwise offer the SELLER as an
  // eligible buyer. Measured on the draft: canNameBuyer returned ok.
  if (!ctx.sellerProfileId || buyerProfileId === ctx.sellerProfileId) return deny('buyer_is_seller')
  // Anti-spoof: a client-supplied id is worthless unless it belongs to someone who actually
  // opened a thread with this seller. This is also what makes "one tap, no search box"
  // honest — the list IS the eligible set.
  //
  // ⚠️ SELLER-SCOPED, NOT LISTING-SCOPED, AND THAT IS DELIBERATE. It matches the existing
  // /buyers picker and the anti-spoof check already in POST /api/listings/[id]/sold, whose
  // comment gives the reason: a thread can be RETARGETED to another listing, so scoping to
  // this listing would drop real buyers. The trade-off is that a seller can attribute
  // listing A to someone who only ever discussed listing B — which is why naming a buyer
  // is a CLAIM, not evidence, and cannot move trust until that person confirms it.
  if (!ctx.conversationBuyerProfileIds.includes(buyerProfileId)) return deny('buyer_not_in_conversations')
  // ⚠️ THE DECLINE CHECK READS THE DURABLE HISTORY, NOT saleDeclinedAt + soldToProfileId.
  // Re-marking to external (or to nobody) blanks saleDeclinedAt, so the earlier version
  // laundered a "No" in two taps; a single "who declined" column then failed to a second
  // decliner overwriting the first. Both were measured against the draft. Per-buyer history
  // is what makes this rule survive any sequence of re-attributions.
  //
  // This is the whole of "terminal-ISH": a different buyer is fine, THIS buyer never again.
  if (buyerHistoryEntry(ctx.facts.saleBuyerHistory, buyerProfileId)?.declinedAt !== undefined) return deny('buyer_declined')
  // Belt and braces: the history is JSON and parses fail-safe to EMPTY, which forgets declines.
  // The scalar stamp still describes the CURRENT attribution, so a corrupt blob cannot re-open
  // the person who just said no — only older decliners, which is the honest residual.
  if (ctx.facts.saleDeclinedAt && ctx.facts.soldToProfileId === buyerProfileId) return deny('buyer_declined')
  return ALLOW
}

/**
 * Normalize the agreed price. Returns `undefined` for "supplied but implausible" so the
 * caller can tell it apart from a legitimate "the seller did not say" (null).
 * VND has no subunit, so the result is always a whole đồng.
 */
export function normalizeSalePrice(raw: unknown, askingPrice: number | null): number | null | undefined {
  // A blank or whitespace-only field is an EMPTY form input, i.e. "the seller did not say" —
  // not a malformed number. Trim before the emptiness test or '   ' becomes invalid_price.
  const trimmed = typeof raw === 'string' ? raw.trim() : raw
  if (trimmed === null || trimmed === undefined || trimmed === '') return null
  const n = typeof trimmed === 'number' ? trimmed : typeof trimmed === 'string' ? Number(trimmed) : NaN
  if (!Number.isFinite(n) || n <= 0) return undefined
  const v = Math.round(n)
  if (v <= 0) return undefined
  // Applies ALWAYS, including when the ratio bounds below are skipped.
  if (v > TRADE_LOOP.SALE_PRICE_ABS_MAX) return undefined
  // Ratio bounds only apply when there is a sane ask to compare against.
  if (askingPrice !== null && Number.isFinite(askingPrice) && askingPrice > 0) {
    if (v < askingPrice * TRADE_LOOP.SALE_PRICE_MIN_FRACTION) return undefined
    if (v > askingPrice * TRADE_LOOP.SALE_PRICE_MAX_MULTIPLE) return undefined
  }
  return v
}

export type MarkSoldResult = { ok: true; patch: MarkSoldPatch } | { ok: false; reason: DenyReason }

/**
 * The full mark-sold transition: authorization, buyer eligibility, price sanity, and the
 * exact columns to write. One call, so no route can implement four of the five rules.
 */
export function validateMarkSold(input: MarkSoldInput, ctx: MarkSoldContext): MarkSoldResult {
  const auth = canMarkSold(ctx)
  if (!auth.ok) return auth

  if (input.channel !== null && input.channel !== undefined && input.channel !== 'eno' && input.channel !== 'external') {
    return deny('invalid_channel')
  }

  const price = normalizeSalePrice(input.salePrice, ctx.askingPrice)
  if (price === undefined) return deny('invalid_price')

  // ⚠️ A CONFIRMED SALE IS SETTLED AND CANNOT BE RE-MARKED. Every patch below clears
  // saleConfirmedAt, so without this a seller could void a buyer's confirmation — and with it
  // the review prompt that confirmation unlocks — by tapping Mark-sold once more. That is a
  // one-tap way to erase an incoming bad review, which reviewers flagged twice. The single
  // exception, handled inside the eno branch, is an EXACT no-op re-tap (same buyer, same
  // price), which changes nothing and so must not be punished. A genuine mistake on a settled
  // sale is an admin matter; it is not worth a self-service hole in the review system.
  const alreadyConfirmed = saleState(ctx.facts) === 'confirmed'
  if (alreadyConfirmed && input.channel !== 'eno') return deny('already_confirmed')

  if (input.channel === 'eno') {
    const buyerProfileId = typeof input.buyerProfileId === 'string' ? input.buyerProfileId.trim() : ''
    if (!buyerProfileId) return deny('no_buyer_named')
    const named = canNameBuyer(buyerProfileId, ctx)
    if (!named.ok) return named

    const history = parseBuyerHistory(ctx.facts.saleBuyerHistory)
    const prior = history.find((e) => e.id === buyerProfileId)
    const sameBuyerNow = ctx.facts.soldChannel === 'eno' && ctx.facts.soldToProfileId === buyerProfileId
    // An EXACT repeat of the outstanding claim: nothing about the question changed.
    const noOp = sameBuyerNow && ctx.facts.salePrice === price
    // ⚠️ `|| sameBuyerNow` COVERS LEGACY ROWS. A listing marked sold BEFORE saleBuyerHistory
    // existed has no entry, so `prior` alone would restamp its window on the first re-mark and
    // hand back exactly the harassment vector this guards. The current attribution is itself
    // proof this buyer was already asked.
    const alreadyAsked = prior !== undefined || sameBuyerNow
    if (alreadyConfirmed && !noOp) return deny('already_confirmed')

    // ⚠️ THE CONFIRM WINDOW IS ANCHORED TO THIS BUYER'S FIRST ASK AND IS IMMOVABLE. Three
    // drafts died here, each defeated by measuring rather than reasoning:
    //   · anchored on `soldChannel === 'eno'` → mark external, mark the buyer again: both clocks
    //     restamped. Probe: 300 notifications over 300 days.
    //   · anchored on `facts.soldAt`          → the intermediate external mark restamps soldAt,
    //     so the window crept forward a day per round and never closed (it reached 2027-05-28
    //     from an 2026-08-01 sale).
    //   · anchor written as `ctx.now`         → a LEGACY row (sold before saleBuyerHistory
    //     existed) took its anchor from the re-mark instead of the original sale, extending its
    //     own window on the first double-tap.
    // So the anchor is written ONCE, from the sale this buyer was actually asked about, and
    // `soldAt` is left to mean what it has always meant (see confirmWindowAnchor).
    const anchor = prior ? new Date(prior.askedAt) : sameBuyerNow && ctx.facts.soldAt ? ctx.facts.soldAt : ctx.now
    // What price was this buyer last asked about? `undefined` = we have never asked them.
    const lastAskedPrice = prior ? prior.askedPrice : sameBuyerNow ? ctx.facts.salePrice : undefined
    const sameQuestion = lastAskedPrice !== undefined && lastAskedPrice === price
    // ⚠️ A CHANGED PRICE RE-ASKS **IMMEDIATELY**, OR THE MARK-SOLD IS REFUSED. Never "accept the
    // edit quietly": the buyer's outstanding notification quotes a number, so `salePrice` and the
    // recorded question must never diverge. Gating this on the reminder cooldown did exactly that
    // and both external reviewers found the same trap — the column moved to P2 while the buyer's
    // question stayed P1, so their answer could not satisfy a price-bound conditional write and
    // the prompt became visible-but-unanswerable for five days. The budget below is what makes an
    // instant re-ask safe: a correction costs one ask, and there are only ever three.
    const asksSoFar = prior?.asks ?? 0
    const canAskAgain = withinConfirmWindow(anchor, ctx.now) && asksSoFar < TRADE_LOOP.MAX_MARK_SOLD_ASKS
    if (alreadyAsked && !sameQuestion && !canAskAgain) return deny('ask_budget_exhausted')
    const askNow = !alreadyAsked || !sameQuestion
    const promptedAt = askNow ? ctx.now : ctx.facts.saleConfirmPromptedAt
    // ⚠️ `askedPrice` and `asks` move ONLY when the ask actually goes out — recording a question
    // nobody was asked is the divergence described above, in miniature.
    const nextHistory = prior
      ? askNow
        ? history.map((e) => (e.id === buyerProfileId ? { ...e, askedPrice: price, asks: asksSoFar + 1 } : e))
        : history
      // ⚠️ `asks: askNow ? 1 : 0` — NOT a bare 1. Creating the entry is not the same event as
      // sending the notification: a legacy row (no history) whose current attribution already
      // names this buyer at this same price is `sameQuestion`, so nothing goes out, and
      // hard-coding 1 charged the budget for an ask the buyer never received. That is the
      // "recorded question with no notification" divergence this file exists to eliminate,
      // reappearing in the one branch that writes the entry for the first time. Measured on the
      // draft with a null price: notification sent = false, asks recorded = 1.
      : [...history, { id: buyerProfileId, askedAt: anchor.getTime(), askedPrice: price, asks: askNow ? 1 : 0 }]
    return {
      ok: true,
      patch: {
        status: 'sold',
        soldChannel: 'eno',
        soldToProfileId: buyerProfileId,
        soldPlatform: null,
        // Honest "when it sold": always the current event, never back-dated. Only an exact
        // no-op re-tap leaves it alone, because nothing happened. The window lives in `anchor`.
        soldAt: noOp && ctx.facts.soldAt ? ctx.facts.soldAt : ctx.now,
        salePrice: price,
        saleConfirmedAt: noOp ? ctx.facts.saleConfirmedAt : null,
        saleDeclinedAt: null,
        saleBuyerHistory: serializeBuyerHistory(nextHistory),
        saleConfirmPromptedAt: promptedAt,
      },
    }
  }

  if (input.channel === 'external') {
    const platform = (typeof input.platform === 'string' ? input.platform : '').trim().slice(0, TRADE_LOOP.MAX_PLATFORM_LEN) || null
    return {
      ok: true,
      patch: {
        status: 'sold',
        soldChannel: 'external',
        soldToProfileId: null,
        soldPlatform: platform,
        soldAt: ctx.now,
        salePrice: price,
        saleConfirmedAt: null,
        saleDeclinedAt: null,
        saleBuyerHistory: ctx.facts.saleBuyerHistory,
        // ⚠️ PRESERVED, NOT NULLED — this is the record of when the buyer was last ASKED, and
        // nulling it here destroyed the cooldown evidence. A seller round-tripping through this
        // branch made every return to the buyer look like a first ask: measured at 336 asks in
        // a year of hourly toggling, after the cooldown had already been added to the eno path.
        // There is nobody to ask on an off-platform sale, and nextConfirmPrompt ignores this
        // value unless the state is awaiting_buyer, so keeping it costs nothing.
        saleConfirmPromptedAt: ctx.facts.saleConfirmPromptedAt,
      },
    }
  }

  // No attribution at all — the shape paths 2–5 send today. Still a sale, still removes
  // the listing, still records the price if one was given; simply never countable.
  return {
    ok: true,
    patch: {
      status: 'sold',
      soldChannel: null,
      soldToProfileId: null,
      soldPlatform: null,
      soldAt: ctx.now,
      salePrice: price,
      saleConfirmedAt: null,
      saleDeclinedAt: null,
      saleBuyerHistory: ctx.facts.saleBuyerHistory,
      // Preserved for the same reason as the external branch above.
      saleConfirmPromptedAt: ctx.facts.saleConfirmPromptedAt,
    },
  }
}

// ── The buyer's answer ────────────────────────────────────────────────────────────

export type RespondContext = {
  actorProfileId: string | null
  sellerProfileId: string | null
  facts: SaleFacts
  now: Date
}

/**
 * Who may answer the "did you buy this?" prompt, and when.
 *
 * ⚠️ THE SELLER CHECK COMES FIRST AND IS NOT REDUNDANT. It fires even when the seller has
 * somehow been named as their own buyer — the case where an `actor !== soldToProfileId`
 * test would happily let them through and mint trust from a one-person trade. Order here
 * is a security property, not cosmetics.
 */
export function canRespondToSale(ctx: RespondContext): Decision {
  const state = saleState(ctx.facts)
  if (state === 'unsold') return deny('not_sold')
  if (!ctx.actorProfileId) return deny('not_the_buyer')
  // ⚠️ AN UNRESOLVABLE SELLER IS A REFUSAL, NOT A SKIPPED CHECK. Guarding the self-confirm test
  // with `ctx.sellerProfileId &&` made it fail OPEN: a row whose named buyer is in fact the
  // seller could be confirmed by that seller whenever the caller could not resolve the
  // storefront owner. We cannot prove the actor is not the seller, so we do not let them answer.
  if (!ctx.sellerProfileId) return deny('not_the_buyer')
  if (ctx.actorProfileId === ctx.sellerProfileId) return deny('seller_cannot_confirm')
  // ⚠️ IDENTITY BEFORE OUTCOME. `already_confirmed` / `already_declined` used to be returned
  // ahead of this line, which let ANY signed-in user probe an endpoint with a listing id and
  // learn whether that sale was confirmed, declined, still open or off-platform. Trust totals
  // are public; "this named buyer refused this seller" is not. A stranger now gets exactly one
  // answer — not_the_buyer — for every state.
  if (!ctx.facts.soldToProfileId || ctx.actorProfileId !== ctx.facts.soldToProfileId) return deny('not_the_buyer')
  // ⚠️ A TAKEDOWN AFTER THE SALE STOPS THE LOOP DEAD. canMarkSold refuses to mark a pulled
  // listing sold, but an item can be sold and taken down LATER, and without this the buyer could
  // still answer the pending prompt — minting trust and a guidance price for goods the platform
  // was ordered to remove. It sits BELOW the identity check for the same reason the outcome
  // reasons do: a stranger must not be able to distinguish a taken-down listing from any other.
  if (ctx.facts.complianceStatus === 'taken_down') return deny('listing_unavailable')
  if (state === 'confirmed') return deny('already_confirmed')
  if (state === 'declined') return deny('already_declined')
  if (state !== 'awaiting_buyer') return deny('no_buyer_named') // off_platform / unattributed
  if (!withinConfirmWindow(confirmWindowAnchor(ctx.facts), ctx.now)) return deny('confirm_window_closed')
  return ALLOW
}

/** The columns a Yes / No answer writes. Pure — the caller persists it. */
export type BuyerResponsePatch = {
  saleConfirmedAt: Date | null
  saleDeclinedAt: Date | null
  saleBuyerHistory: string | null
}

/**
 * ⚠️ CALLERS MUST PERSIST THIS AS A CONDITIONAL WRITE, NOT A BLIND UPDATE. Authorization
 * (canRespondToSale) and mutation are separate pure steps here, so two simultaneous taps —
 * Yes on the phone, No on the laptop — both pass validation and the last write wins. The
 * update must carry the precondition it was authorized under:
 *     UPDATE "Listing" SET … WHERE id = $1
 *       AND "saleConfirmedAt" IS NULL AND "saleDeclinedAt" IS NULL
 *       AND "soldToProfileId" = $buyer AND "soldChannel" = 'eno'
 *       AND "salePrice" IS NOT DISTINCT FROM $priceTheBuyerWasShown   -- confirmPromptPrice()
 * and treat a 0-row result as "the question moved" (re-read and re-authorize).
 *
 * ⚠️ THE PRECONDITION MUST BIND THE ATTRIBUTION, NOT JUST THE NULL-NESS. A reviewer walked
 * the race: the buyer passes authorization, the seller re-attributes to somebody else or edits
 * the price, and a null-only WHERE then stamps the NEW attribution as confirmed — crediting
 * trust to a buyer who never answered and admitting a price nobody agreed to. Carry the buyer
 * and the price the answer was given about. This module cannot enforce it (being pure is the
 * point), so it is stated where the patch is produced.
 *
 * A "no" is recorded AGAINST THAT BUYER in the durable history, never in a single shared slot:
 * an item declined by A and then declined by B must still refuse a future re-attribution to
 * EITHER. A "yes" leaves the history exactly as it was.
 */
export function buyerResponsePatch(answer: 'yes' | 'no', now: Date, facts: SaleFacts): BuyerResponsePatch {
  if (answer === 'yes') return { saleConfirmedAt: now, saleDeclinedAt: null, saleBuyerHistory: facts.saleBuyerHistory }
  const history = parseBuyerHistory(facts.saleBuyerHistory)
  const buyerId = facts.soldToProfileId
  let next = history
  if (buyerId) {
    const existing = history.find((e) => e.id === buyerId)
    next = existing
      ? history.map((e) => (e.id === buyerId ? { ...e, declinedAt: now.getTime() } : e))
      // Defensive: a decline on a listing whose ask predates the history column still records.
      : [...history, { id: buyerId, askedAt: now.getTime(), declinedAt: now.getTime() }]
  }
  return { saleConfirmedAt: null, saleDeclinedAt: now, saleBuyerHistory: serializeBuyerHistory(next) }
}

/**
 * When this buyer's ONE confirm window started.
 *
 * ⚠️ THIS IS NOT `soldAt`, AND CONFLATING THEM COST TWO ROUNDS OF REVIEW. `soldAt` answers
 * "when did this sell" — it is read for the sold-date copy, for recency and by the sweep, so it
 * must always move forward with the actual event and must never be back-dated. The confirm
 * window instead has to be IMMOVABLE per buyer, or a seller re-marking in a loop drags it along
 * and the "three asks" bound evaporates (measured: 336 notifications in 14 days of hourly price
 * flips). Keeping the anchor in the buyer's own history entry lets both be true at once.
 * Falls back to soldAt for rows that predate saleBuyerHistory.
 */
export function confirmWindowAnchor(facts: SaleFacts): Date | null {
  const entry = facts.soldToProfileId ? buyerHistoryEntry(facts.saleBuyerHistory, facts.soldToProfileId) : undefined
  return entry ? new Date(entry.askedAt) : facts.soldAt
}

/** True while the buyer may still be asked / may still answer. No anchor at all is closed. */
export function withinConfirmWindow(anchor: Date | null, now: Date): boolean {
  if (!anchor) return false
  const elapsed = now.getTime() - anchor.getTime()
  return elapsed >= 0 && elapsed <= TRADE_LOOP.CONFIRM_WINDOW_DAYS * DAY_MS
}

// ── Re-prompting ──────────────────────────────────────────────────────────────────

export type PromptReason =
  | 'first_prompt'
  | 're_prompt'
  | 'not_awaiting' // confirmed, declined, off-platform, unattributed or unsold
  | 'no_sale_time' // sold with no soldAt — nothing to measure the window from
  | 'cooldown'
  | 'window_closed'

export type PromptDecision = { send: boolean; reason: PromptReason }

/**
 * Should the buyer be asked (again) right now? Bounded by BOTH a cooldown since the last
 * ask and a deadline from the sale itself — which is why no attempt counter exists in the
 * schema. A decline can never reach 'first_prompt'/'re_prompt' because saleState reports
 * it as 'declined' and it falls out at the first branch: a "No" silences the reminder
 * permanently, which is the behaviour the spec calls terminal-ish.
 */
export function nextConfirmPrompt(facts: SaleFacts, now: Date): PromptDecision {
  if (saleState(facts) !== 'awaiting_buyer') return { send: false, reason: 'not_awaiting' }
  // ⚠️ THE SWEEP MUST HONOUR A TAKEDOWN TOO. canRespondToSale refuses these, so without this the
  // cron nudges a buyer up to three times about goods under an authority order and every tap is
  // met with `listing_unavailable`. The takedown rule has to hold at EVERY entry point or it
  // just relocates the damage.
  if (facts.complianceStatus === 'taken_down') return { send: false, reason: 'not_awaiting' }
  if (!facts.soldAt) return { send: false, reason: 'no_sale_time' }
  if (!withinConfirmWindow(confirmWindowAnchor(facts), now)) return { send: false, reason: 'window_closed' }
  if (!facts.saleConfirmPromptedAt) return { send: true, reason: 'first_prompt' }
  const since = now.getTime() - facts.saleConfirmPromptedAt.getTime()
  if (since < TRADE_LOOP.PROMPT_COOLDOWN_HOURS * HOUR_MS) return { send: false, reason: 'cooldown' }
  return { send: true, reason: 're_prompt' }
}

// ── What a sale may and may not count toward ──────────────────────────────────────

/**
 * Did the listing leave the market? TRUE for every sold state including off-platform and
 * unattributed — this is the inventory fact, and it is why recording an off-platform sale
 * is worth doing even though it earns the seller nothing.
 */
export function countsAsSale(facts: SaleFacts): boolean {
  return saleState(facts) !== 'unsold'
}

/**
 * May this sale count toward the seller's trust score / transaction track record?
 * ONLY a buyer-confirmed eno sale. Off-platform and unattributed sales return false
 * forever — not "not yet": there is no second party who can ever be asked.
 */
export function countsTowardTrust(facts: SaleFacts): boolean {
  // A confirmation that predates a takedown does not survive it — see canRespondToSale.
  if (facts.complianceStatus === 'taken_down') return false
  return saleState(facts) === 'confirmed'
}

/**
 * The price to feed sold-price guidance, or null.
 *
 * ⚠️ REQUIRES CONFIRMATION, not merely a number. An unconfirmed salePrice is one party's
 * unverified claim, and a seller who could push made-up figures into the band would be
 * editing the market's idea of what their own goods are worth. A confirmed price was
 * agreed to by the person who paid it.
 */
export function salePriceForGuidance(facts: SaleFacts): number | null {
  if (!countsTowardTrust(facts)) return null
  const p = confirmPromptPrice(facts)
  return typeof p === 'number' && Number.isFinite(p) && p > 0 ? p : null
}

/**
 * The number the buyer was actually SHOWN, which is what their Yes/No is an answer to.
 *
 * ⚠️ USE THIS FOR THE NOTIFICATION COPY AND FOR THE CONDITIONAL WRITE'S PRICE PRECONDITION —
 * not `salePrice`. The two can differ: a seller editing the price inside the cooldown updates
 * the column immediately while the buyer's outstanding question still quotes the old figure,
 * and confirming against the current column would harvest a Yes for a price nobody saw. That
 * is why salePriceForGuidance above reads this rather than the raw column. Falls back to
 * `salePrice` for rows with no history entry.
 */
export function confirmPromptPrice(facts: SaleFacts): number | null {
  if (!facts.soldToProfileId) return facts.salePrice
  const entry = buyerHistoryEntry(facts.saleBuyerHistory, facts.soldToProfileId)
  return entry && entry.askedPrice !== undefined ? entry.askedPrice : facts.salePrice
}

/**
 * May the review prompt appear to this viewer? ONLY after both sides have spoken, and
 * only to the two counterparties. This is the gate the spec means by "ONLY after BOTH
 * sides confirm does the review prompt appear".
 */
export function canPromptReview(facts: SaleFacts, viewerProfileId: string | null, sellerProfileId: string | null): Decision {
  // ⚠️ IDENTITY BEFORE OUTCOME, for the same reason as canRespondToSale — and this one was
  // missed on the first pass. Testing confirmation first made the pair of reasons a probe: a
  // bystander got `not_confirmed` for an awaiting or declined sale and `not_the_buyer` for a
  // confirmed one, which reveals per-sale outcomes to anyone with a listing id.
  if (!viewerProfileId) return deny('not_the_buyer')
  const isBuyer = viewerProfileId === facts.soldToProfileId
  const isSeller = sellerProfileId !== null && viewerProfileId === sellerProfileId
  if (!isBuyer && !isSeller) return deny('not_the_buyer')
  if (!countsTowardTrust(facts)) return deny('not_confirmed')
  return ALLOW
}
