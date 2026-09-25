import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { kv, rateLimit } from '@/lib/ratelimit'
import { logError } from '@/lib/log'
import { IS_SERVICES } from '@/lib/edition'
import { messagingGate } from '@/lib/enforcement'
import { insertMessage, parseMessageMeta } from '@/lib/messages'
import { ApiError, route } from '@/lib/api/handler'
import { getOrCreateListinglessThread } from '@/lib/support-thread'
import { RENTAL_DESK_SELLER_ID } from '@/lib/rental-check/desk-ids'
import {
  ensureRentalDeskSeller, repointRentalDeskThreads, resolveCheckableRentals, resolveRentalOperatorProfileId,
  type CheckableRental,
} from '@/lib/rental-check/desk'
import {
  RENTAL_CHECK_CHANNELS, RENTAL_CHECK_ID_RE, RENTAL_CHECK_MAX_ITEMS, RENTAL_CHECK_MAX_REQUIREMENTS,
  RENTAL_CHECK_REQUEST_ID_RE, normaliseRentalContact,
  type AvailabilityRequestItem, type AvailabilityRequestMeta, type RentalCheckOk,
} from '@/lib/rental-check/shared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/rental-check — "check these rentals for me".
 *
 * A signed-in person sends up to five rentals, what they need, and one way to reach them. The
 * request becomes ONE card (`availability_request`) in their listing-less thread with this edition's
 * rental desk, whose `sellerProfileId` is the operator (support@eno.forum by default) — so it lands
 * in the operator's own /messages inbox, and the requester sees the answer in theirs.
 *
 * Order of work, and why each step sits where it does:
 *   1. messagingGate      — a suspended account is refused before its body is even read (the same
 *                           ordering the message send route keeps; see its note on the wrapper).
 *   2. zod                — shape only. 400 bad_request.
 *   3. contact            — the one free-text field that becomes a link. 422 invalid_contact.
 *   4. kv claim           — serialises concurrent tabs/retries of ONE logical submit. Fails CLOSED.
 *   5. requestId lookup   — a committed card for this clientRequestId is replayed, never duplicated,
 *                           and before anything that could refuse it.
 *   6. listings           — every id must be live, verified, a rental, and visible on THIS edition.
 *                           409 listings_unavailable, and NOTHING is written.
 *   7. operator           — no resolvable operator → 503 desk_unavailable (never a thread nobody reads).
 *   8. new-card limit     — 6 per hour, counted only here, so a replay can never be refused.
 *   9. desk + thread      — once per process, re-point this desk's threads at the operator; desk
 *                           created lazily (ON CONFLICT DO NOTHING); one thread per requester per
 *                           edition (the partial unique index). A thread this request opened is
 *                           removed again if its card then fails.
 *  10. insert             — items snapshotted HERE from the database rows, not from the client.
 *  11. store              — the 200 body under the claim, for a replay.
 *
 * ⛔ IDEMPOTENCY HAS TWO LAYERS, AND THE DATABASE ONE IS THE DURABLE ONE. The kv claim alone would
 * lose a request if the process died between the insert committing and the body being stored: the
 * claim expires after 300 s and a retry would then insert a SECOND card. So the card itself carries
 * the id (`meta.requestId`), and both the in-flight path and the insert path look for it in the
 * thread first. The kv key carries the edition because kv_store is shared by both deployments.
 */

const bodySchema = z.object({
  // Bounded before the dedupe so a giant array costs nothing; the 1..5 rule applies AFTER it.
  listingIds: z.array(z.string().regex(RENTAL_CHECK_ID_RE)).min(1).max(RENTAL_CHECK_MAX_ITEMS * 2),
  requirements: z.string().max(RENTAL_CHECK_MAX_REQUIREMENTS * 4).optional(),
  contact: z.object({ channel: z.enum(RENTAL_CHECK_CHANNELS), value: z.string().max(1000) }),
  clientRequestId: z.string().regex(RENTAL_CHECK_REQUEST_ID_RE),
  lang: z.enum(['en', 'vi']).optional(),
})

/**
 * Control characters out, line breaks kept (normalised to \n), tabs to a space, then trimmed.
 * ⚠️ BIDI OVERRIDES GO TOO (U+202A–U+202E, U+2066–U+2069): the operator reads this text next to a
 * phone number, and an override can make "0901…" display as a different number.
 */
function sanitiseRequirements(raw: string | undefined): string {
  return (raw ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .trim()
}

const CURRENCY_RE = /^(?:₫|[A-Z]{3})$/
const IMAGE_RE = /^(?:https:\/\/|\/(?![/\\]))[^\s\\]*$/

/** The first photo, when it is one the card may show — otherwise the card draws its placeholder. */
function firstImage(images: string): string | null {
  try {
    const first = (JSON.parse(images || '[]') as unknown[])[0]
    return typeof first === 'string' && first.length <= 512 && IMAGE_RE.test(first) ? first : null
  } catch {
    return null
  }
}

/**
 * The card's copy of one rental, AS IT WAS WHEN ASKED. Built from the database row, never from the
 * request body — the client sends ids and nothing else about a listing.
 * ⚠️ `₫` when the stored currency is not a symbol the card schema accepts: core/listings.ts types
 * every created listing's currency as the literal `₫`, so this branch is a legacy-row guard, not a
 * conversion.
 */
function snapshot(row: CheckableRental): AvailabilityRequestItem {
  return {
    id: row.id,
    title: (row.title ?? '').slice(0, 140),
    titleVi: row.titleVi ? row.titleVi.slice(0, 140) : null,
    image: firstImage(row.images),
    price: Number.isFinite(row.price) ? Math.min(Math.max(row.price, 0), 1e13) : 0,
    currency: CURRENCY_RE.test(row.currency) ? row.currency : '₫',
    priceUnit: (row.priceUnit ?? '').slice(0, 32),
  }
}

/**
 * The committed card for this request id in this requester's thread, if there is one.
 * ⚠️ `contains` on the JSON TEXT narrows the search — the id is RENTAL_CHECK_REQUEST_ID_RE (no quotes,
 * no backslashes) and JSON.stringify writes the key exactly as `"requestId":"<id>"` — and every hit is
 * re-parsed through the strict schema and compared EXACTLY before it is trusted.
 */
async function findCommitted(profileId: string, requestId: string): Promise<RentalCheckOk | null> {
  const thread = await db.conversation.findFirst({
    where: { buyerProfileId: profileId, sellerId: RENTAL_DESK_SELLER_ID, listingId: null },
    select: { id: true },
  })
  if (!thread) return null
  // ⚠️ `findMany` + an exact re-check, not `findFirst`: `contains` is a LIKE, and `_` (legal in a
  // request id) is a LIKE wildcard — so a first hit could be ANOTHER request's card, and stopping at
  // it would miss the real one and insert a duplicate.
  // ⚠️ NO `take`: a cap would let enough wildcard look-alikes crowd the real card out (codex). The scan
  // is one requester's thread, one card kind, at most six new cards an hour.
  const candidates = await db.message.findMany({
    where: { conversationId: thread.id, kind: 'availability_request', metaJson: { contains: `"requestId":"${requestId}"` } },
    select: { id: true, metaJson: true },
    orderBy: { createdAt: 'desc' },
  })
  for (const msg of candidates) {
    const meta = parseMessageMeta('availability_request', msg.metaJson)
    if (meta && meta.requestId === requestId) {
      return { conversationId: thread.id, messageId: msg.id, threadCreated: false, listingIds: meta.items.map((i) => i.id) }
    }
  }
  return null
}

/**
 * ⚠️ TWO LIMITS, AND THE STRICT ONE COUNTS CARDS, NOT CALLS. A single logical submit can legitimately
 * arrive several times — the client retries `send_in_flight` up to three times, a lost response is
 * retried with the same id, and a sign-in round trip auto-submits once more. With the 6/hour limit on
 * the wrapper, those REPLAYS spent the budget, and a person whose request had already been delivered
 * could be answered 429 instead of the stored 200 — told to wait for something that had worked (the
 * Opus seat's catch on round one). So:
 *   · the wrapper bounds every ATTEMPT generously (abuse only: 30/hour per person), and
 *   · `rental-check` — 6 NEW cards per hour — is checked only when a card is about to be written, after
 *     every replay path has had its chance. A replay is never rate-limited.
 * Both answer the same 429 body and Retry-After header, so the client handles one shape.
 */
const NEW_CARDS_PER_HOUR = 6

export const POST = route(
  { auth: 'profile', rateLimit: { bucket: 'rental-check-attempt', limit: 30, window: '1 h' } },
  async ({ req, profile }) => {
    // 1. A suspended account cannot message — and this is a message.
    const gate = await messagingGate(profile.id)
    if (gate) return NextResponse.json(gate, { status: 403 })

    // 2. Shape.
    let raw: unknown
    try { raw = await req.json() } catch { throw new ApiError('bad_request', 400) }
    const parsed = bodySchema.safeParse(raw)
    if (!parsed.success) throw new ApiError('bad_request', 400)
    const body = parsed.data
    const listingIds = [...new Set(body.listingIds)]
    if (listingIds.length > RENTAL_CHECK_MAX_ITEMS) throw new ApiError('bad_request', 400)
    const requirements = sanitiseRequirements(body.requirements)
    if (requirements.length > RENTAL_CHECK_MAX_REQUIREMENTS) throw new ApiError('bad_request', 400)

    // 3. The contact — normalised with the SAME function the form ran, so both agree on what is valid.
    const contact = normaliseRentalContact(body.contact.channel, body.contact.value)
    if (!contact.ok) return NextResponse.json({ error: 'invalid_contact', reason: contact.reason }, { status: 422 })

    // 4. Claim this logical submit.
    // ⛔ FAILS CLOSED, unlike the message send route's claim (codex, round two). This claim is the only
    // thing serialising two tabs that submit the same id at once — the database lookup below is
    // durable but not atomic — so failing open is precisely what would let both insert a card. And
    // kv_store lives in the same Postgres the insert needs: a kv error is a database error, and the
    // request it "saves" would fail at the insert anyway. A throw here is a 500 the client retries.
    const requestId = body.clientRequestId
    const idemKey = `rentalchk:${IS_SERVICES ? 'forum' : 'vn'}:${profile.id}:${requestId}`
    const claimed = await kv.set(idemKey, 'pending', { nx: true, ex: 300 })
    if (claimed === null) {
      const stored = await kv.get<RentalCheckOk | 'pending'>(idemKey).catch(() => null)
      if (stored && stored !== 'pending') return stored
      // ⚠️ 'pending' MAY BE A CRASHED WINNER, not a live one — so look for its card before saying
      // "in flight". A committed card answers 200; only a genuinely unfinished one gets 409.
      const committed = await findCommitted(profile.id, requestId)
      if (committed) {
        await kv.set(idemKey, committed, { ex: 86_400 }).catch((e) => logError(e, { op: 'rental-check.kv-set' }))
        return committed
      }
      throw new ApiError('send_in_flight', 409)
    }

    // Every exit that did not commit releases the claim, so the client's retry is allowed to run.
    let committed = false
    try {
      // 5. Already sent under this id (a retry after a lost response, after kv lost the body)?
      //    Replay it, never duplicate. READ-ONLY, and FIRST: a request that was delivered must be
      //    answered 200 even if one of its rentals has since gone, the operator is misconfigured, or
      //    the strict limit is spent — and a refused request must open no empty thread.
      const already = await findCommitted(profile.id, requestId)
      if (already) {
        committed = true
        await kv.set(idemKey, already, { ex: 86_400 }).catch((e) => logError(e, { op: 'rental-check.kv-set' }))
        return already
      }

      // 6. Every id must be checkable HERE. The whole request is refused rather than silently
      //    trimmed — the client marks the rows and lets the person decide.
      const rows = await resolveCheckableRentals(listingIds)
      const byId = new Map(rows.map((r) => [r.id, r]))
      const unavailable = listingIds.filter((id) => !byId.has(id))
      if (unavailable.length) {
        return NextResponse.json({ error: 'listings_unavailable', unavailable }, { status: 409 })
      }

      // 7. Who answers.
      const operatorId = await resolveRentalOperatorProfileId()
      if (!operatorId) {
        logError(new Error('rental-check: RENTAL_CHECK_OPERATOR_EMAIL resolves to no profile'), { op: 'rental-check.operator' })
        throw new ApiError('desk_unavailable', 503)
      }

      // 8. The strict limit — new cards only (see NEW_CARDS_PER_HOUR). Mirrors the wrapper's dev skip.
      if (process.env.NODE_ENV !== 'development') {
        const rl = await rateLimit('rental-check', profile.id, NEW_CARDS_PER_HOUR, '1 h')
        if (!rl.success) {
          return NextResponse.json(
            { error: 'rate_limited', retryAfterSeconds: rl.resetSec },
            { status: 429, headers: { 'Retry-After': String(rl.resetSec) } },
          )
        }
      }

      // 9. The desk, this person's thread with it — and, once per process, every existing desk thread
      //    re-pointed at the current operator (after the limit, so a refused request writes nothing).
      await repointRentalDeskThreads(operatorId)
      await ensureRentalDeskSeller()
      const thread = await getOrCreateListinglessThread(db, {
        buyerProfileId: profile.id,
        sellerId: RENTAL_DESK_SELLER_ID,
        sellerProfileId: operatorId,
      })

      // 10. The card. Items in the order the person collected them.
      const items = listingIds.map((id) => snapshot(byId.get(id)!))
      const lang: 'en' | 'vi' = body.lang ?? (profile.locale?.startsWith('vi') ? 'vi' : 'en')
      const meta: AvailabilityRequestMeta = {
        v: 1,
        requestId,
        items,
        requirements,
        contact: { channel: body.contact.channel, value: contact.value },
        origin: IS_SERVICES ? 'forum' : 'vn',
        lang,
      }
      let message: Awaited<ReturnType<typeof insertMessage>>
      try {
        message = await insertMessage(
          { id: thread.id, buyerProfileId: profile.id, sellerProfileId: operatorId, listingId: null, sellerId: RENTAL_DESK_SELLER_ID },
          profile.id,
          '',
          {
            kind: 'availability_request',
            meta,
            // ⚠️ NEVER THE CONTACT. This lands in Conversation.lastMessageText, which both inboxes
            // read in plain text; the number belongs inside the card only.
            preview: `Kiểm tra phòng trống · Availability check (${items.length})`,
          },
        )
      } catch (e) {
        /**
         * ⚠️ DO NOT LEAVE AN EMPTY THREAD BEHIND (codex, round two). The thread and the card are two
         * writes; a thread opened a moment ago whose card then failed would sit in BOTH inboxes as an
         * "eno team" conversation with nothing in it. Only a thread THIS request created is removed,
         * and only while it still holds no message — a concurrent request that has already posted
         * into it keeps it. Best-effort: the original error is what the caller hears.
         */
        if (thread.created) {
          await db.conversation
            .deleteMany({ where: { id: thread.id, listingId: null, messages: { none: {} } } })
            .catch((err) => logError(err, { op: 'rental-check.empty-thread-cleanup' }))
        }
        throw e
      }
      committed = true

      // 11. Stored for a replay. Best-effort: a miss is covered by the database lookup above.
      const ok: RentalCheckOk = { conversationId: thread.id, messageId: message.id, threadCreated: thread.created, listingIds }
      await kv.set(idemKey, ok, { ex: 86_400 }).catch((e) => logError(e, { op: 'rental-check.kv-set' }))
      return ok
    } finally {
      if (!committed) await kv.del(idemKey).catch((e) => logError(e, { op: 'rental-check.kv-del' }))
    }
  },
)
