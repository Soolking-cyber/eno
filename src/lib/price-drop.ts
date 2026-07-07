import 'server-only'
import { db } from '@/lib/db'
import { sendPushToProfile } from '@/lib/push'
import { formatMoneyFull, dropPercent } from '@/lib/vnd'

// ── Price-drop rules engine (anti-fake-discount, 2026-07-07) ─────────────────────
//
// A seller "uses" the price-drop feature simply by lowering the price — there is no
// seller-entered "was" price ANYWHERE. The struck-through anchor is server-computed
// as the LOWEST price the listing was offered at in the trailing 30 days (the
// EU-Omnibus Art 6a reference rule), read from the append-only PriceChange audit.
// That single rule makes raise-then-drop mathematically worthless: the pre-raise
// price stays in the 30-day window, so the "drop" is measured against it.
//
// A qualifying drop earns (a) the badge for 1 day and (b) at most ONE buyer
// notification per listing per 24h — and only when the new price undercuts the
// lowest price buyers were EVER notified at by ≥10% (a monotonic ratchet that no
// raise resets), so every ping a buyer receives is a genuinely better deal.
// Non-qualifying decreases still change the price — they just earn nothing.
//
// All gates are DB-timestamp-enforced (survive Redis outages) and live behind
// updateListingCore — the single write path shared by the web PATCH and the
// partner API, so no caller can bypass them.

const DAY = 24 * 60 * 60 * 1000

export const DROP = {
  WINDOW_MS: 30 * DAY,        // reference window: lowest offered price in 30 days
  BADGE_MS: 1 * DAY,          // drop badge lifetime — after a day the cut just becomes the normal price
  MIN_PRICE: 50_000,          // ₫ floor — penny listings can't farm drop badges
  TYPO_FLOOR: 0.2,            // below 20% of ref = probable typo/giá ảo → no badge
  BAND_SPLIT: 5_000_000,      // ₫ — the % needed to qualify depends on price band
  BAND_SMALL: 0.9,            // < 5M: must drop ≥10% below the 30-day reference
  BAND_LARGE: 0.95,           // ≥ 5M: ≥5% is already meaningful money
  MIN_AGE_MS: 72 * 3600_000,  // listing must be ≥72h old (no post-high-discount-today)
  MIN_HOLD_MS: 72 * 3600_000, // current price must have been held ≥72h (FTC bona fide)
  MAX_RAISES_7D: 2,           // ≥3 raises in 7 days = price-cycling → suppress rewards
  NOTIFY_RATCHET: 0.9,        // notify only ≥10% below the lowest EVER notified price
  NOTIFY_COOLDOWN_MS: 1 * DAY, // max 1 notification per listing per 24h
  RECIPIENT_DAILY_CAP: 5,     // max price_drop notifications per recipient per 24h
  AUDIENCE_CAP: 100,          // fan-out bound per drop event
} as const

/** The listing fields the rules engine needs — add these to the update-path select. */
export type DropCurrent = {
  id: string
  price: number
  createdAt: Date
  previousPrice: number | null
  priceDropAt: Date | null
  lowestNotifiedPrice: number | null
  priceDropNotifiedAt: Date | null
}

/**
 * Run the price-change pipeline for an OWNED listing whose price is changing from
 * `current.price` to `newPrice` (caller guarantees they differ). Reads history and
 * returns the audit-row payload for the caller to persist ATOMICALLY with the listing
 * update (so a failed update can't leave a phantom PriceChange that poisons the
 * 30-day reference), the extra `data` fields to merge into that update, and an
 * optional `notify` thunk the caller schedules via after() — never inline, so the
 * fan-out can't delay the PATCH response.
 */
export async function priceChangeEffects(
  current: DropCurrent,
  newPrice: number,
): Promise<{ data: Record<string, unknown>; audit: { listingId: string; oldPrice: number; newPrice: number }; notify: (() => Promise<void>) | null }> {
  const oldPrice = current.price
  const now = Date.now()
  const audit = { listingId: current.id, oldPrice, newPrice }

  // History BEFORE this change — the row we're about to write is NOT persisted here
  // (the caller commits it in one tx with the update), so it can't poison the 30-day
  // minimum, and a failed update leaves no phantom row.
  const rows = await db.priceChange.findMany({
    where: { listingId: current.id, createdAt: { gt: new Date(now - DROP.WINDOW_MS) } },
    orderBy: { createdAt: 'asc' },
    select: { oldPrice: true, newPrice: true, createdAt: true },
  })

  if (newPrice > oldPrice) {
    // Raise → any active badge ends INSTANTLY ("campaign over"). The notification
    // ratchet fields are deliberately untouched: raise-then-drop must never re-arm
    // a notification a buyer already received at a lower price.
    return { data: { previousPrice: null, priceDropAt: null }, audit, notify: null }
  }

  // Reference price: the lowest price offered at any moment inside the window. Each
  // in-window row contributes both sides — its oldPrice was in effect INTO the window
  // (until that change) and its newPrice from it; the current price (oldPrice here)
  // covers the stretch since the last change. Zero rows = price held since creation.
  const ref = Math.min(oldPrice, ...rows.flatMap((r) => [r.oldPrice, r.newPrice]))
  const heldSince = rows.length ? rows[rows.length - 1].createdAt.getTime() : current.createdAt.getTime()
  const raises7d = rows.filter((r) => r.newPrice > r.oldPrice && r.createdAt.getTime() > now - 7 * DAY).length
  const band = ref >= DROP.BAND_SPLIT ? DROP.BAND_LARGE : DROP.BAND_SMALL

  const qualifying =
    newPrice >= DROP.MIN_PRICE &&
    newPrice >= ref * DROP.TYPO_FLOOR &&
    newPrice <= ref * band &&
    now - current.createdAt.getTime() >= DROP.MIN_AGE_MS &&
    now - heldSince >= DROP.MIN_HOLD_MS &&
    raises7d <= DROP.MAX_RAISES_7D

  // Non-qualifying decrease: the price still changes, nothing else. An already-active
  // badge stays (the displayed % grows honestly — it's measured against the anchor).
  if (!qualifying) return { data: {}, audit, notify: null }

  // Progressive campaign (EU rule): further qualifying drops inside an active badge
  // window keep the ORIGINAL anchor (cumulative % shown) and reset the 1-day clock.
  const badgeActive =
    current.previousPrice != null && current.priceDropAt != null && now - current.priceDropAt.getTime() < DROP.BADGE_MS
  const anchor = badgeActive ? current.previousPrice! : ref
  const data: Record<string, unknown> = { previousPrice: anchor, priceDropAt: new Date(now) }

  const cooldownOk = !current.priceDropNotifiedAt || now - current.priceDropNotifiedAt.getTime() >= DROP.NOTIFY_COOLDOWN_MS
  const ratchetOk = current.lowestNotifiedPrice == null || newPrice <= current.lowestNotifiedPrice * DROP.NOTIFY_RATCHET
  let notify: (() => Promise<void>) | null = null
  if (cooldownOk && ratchetOk) {
    data.priceDropNotifiedAt = new Date(now)
    data.lowestNotifiedPrice = newPrice // monotonic by construction (≤ 0.9 × previous floor)
    notify = () => notifyPriceDrop(current.id, anchor, newPrice)
  }
  return { data, audit, notify }
}

/**
 * Fan the drop out to buyers who showed real intent on THIS listing: open
 * conversations + contact reveals (server-side favorites don't exist yet — device
 * hearts never reach the DB). Deduped, seller excluded, capped at AUDIENCE_CAP, and
 * each recipient is protected by a 5-per-24h cap so power-browsers aren't blasted.
 * Best-effort: runs via after(), every failure is swallowed.
 */
async function notifyPriceDrop(listingId: string, fromPrice: number, toPrice: number): Promise<void> {
  try {
    const listing = await db.listing.findUnique({
      where: { id: listingId },
      select: { title: true, currency: true, status: true, verified: true, seller: { select: { ownerId: true } } },
    })
    if (!listing || listing.status !== 'active' || !listing.verified) return
    const sellerProfileId = listing.seller.ownerId

    const [convos, reveals] = await Promise.all([
      db.conversation.findMany({ where: { listingId }, select: { buyerProfileId: true }, orderBy: { createdAt: 'desc' }, take: 200 }),
      db.contactReveal.findMany({ where: { listingId }, select: { viewerId: true }, orderBy: { createdAt: 'desc' }, take: 200 }),
    ])
    const candidateIds = [...new Set([...convos.map((c) => c.buyerProfileId), ...reveals.map((r) => r.viewerId)])]
      .filter((id): id is string => !!id && id !== sellerProfileId)
      .slice(0, DROP.AUDIENCE_CAP)
    if (!candidateIds.length) return

    // ContactReveal.viewerId (and, rarely, a conversation buyer) can point at a
    // since-DELETED account. Notification.recipientId is an FK to Profile, so a single
    // dangling id would make createMany throw an FK violation and atomically drop
    // EVERY notification for this drop — and the cooldown/ratchet were already stamped,
    // so it never retries. Intersect with live Profiles first.
    const live = new Set((await db.profile.findMany({ where: { id: { in: candidateIds } }, select: { id: true } })).map((p) => p.id))
    const ids = candidateIds.filter((id) => live.has(id))
    if (!ids.length) return

    // Recipient-side daily cap in one groupBy (not N counts).
    const since = new Date(Date.now() - DROP.NOTIFY_COOLDOWN_MS)
    const counts = await db.notification.groupBy({
      by: ['recipientId'],
      where: { recipientId: { in: ids }, type: 'price_drop', createdAt: { gt: since } },
      _count: { _all: true },
    })
    const capped = new Set(counts.filter((c) => c._count._all >= DROP.RECIPIENT_DAILY_CAP).map((c) => c.recipientId))
    const recipients = ids.filter((id) => !capped.has(id))
    if (!recipients.length) return

    // The % here is the SAME anchor-based figure as the badge — never a different number.
    const pct = dropPercent(fromPrice, toPrice)
    const body = `"${listing.title}" ${formatMoneyFull(fromPrice, listing.currency)} → ${formatMoneyFull(toPrice, listing.currency)}${pct ? ` (${pct})` : ''}`
    await db.notification.createMany({
      data: recipients.map((recipientId) => ({
        recipientId,
        type: 'price_drop',
        title: 'Price drop', // the bell renders this type with a translated label
        body,
        listingId,
        url: `/listings/${listingId}`,
      })),
    })
    // Best-effort web push, one tag per listing so repeat drops replace, not stack.
    for (const rid of recipients) {
      try {
        await sendPushToProfile(rid, { title: 'Giảm giá · Price drop', body, url: `/listings/${listingId}`, tag: `price-drop-${listingId}` })
      } catch { /* push is optional */ }
    }
  } catch (e) {
    console.error('[price-drop] notify', (e as Error).message)
  }
}
