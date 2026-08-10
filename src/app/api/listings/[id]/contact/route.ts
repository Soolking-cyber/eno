import { scopedListingWhere } from '@/lib/edition-scope'
import { NextResponse, after } from 'next/server'
import { clientIp } from '@/lib/client-ip'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { createSupabaseServer } from '@/lib/supabase/server'
import { phoneForSeller, telHref, zaloHref } from '@/lib/contact'
import { rateLimit } from '@/lib/ratelimit'
import { sendMetaCapiEvent, metaUserDataFromHeaders } from '@/lib/meta-capi'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * ⚠️ NO DEFAULT SALT. AN UNSALTED HASH OF AN IP IS NOT A HASH OF AN IP, IT IS AN IP.
 *
 * This read used to be `process.env.CONTACT_IP_SALT || 'eno-contact'`. A fallback printed in a
 * public repository is not a secret, and the input space it protects is IPv4 — 2^32 candidates,
 * which is minutes of brute force against a stolen table. What was MEASURED on 2026-08-05 is that
 * CONTACT_IP_SALT is commented out at .env:40 and undefined in the runtime environment, so the
 * fallback is what today's writes use; whether every historical deployment also lacked the variable
 * was not verified and cannot be from here. Treat pre-2026-08-05 rows as possibly storing the raw
 * client IP of a signed-in buyer — they are worth backfilling to NULL regardless, since nothing
 * reads the column.
 *
 * ⚠️ IT DEGRADES TO NULL RATHER THAN THROWING, AND THAT IS A DELIBERATE DIVERGENCE FROM
 * src/lib/compliance/subject-hash.ts, WHICH FAILS CLOSED FOR THIS EXACT PROBLEM. The difference is
 * what the hash is FOR. There, the digest is load-bearing: it backs a uniqueness index, so an
 * unkeyed fallback would create a second identity namespace and let the same person pass the index
 * twice — a wrong answer is worse than an outage, so it throws. Here `ipHash` is a nullable
 * write-only abuse signal: it is written at :78 and read by NOTHING in the codebase (verified), the
 * column is already `String?`, and this route reveals a seller's phone number to a buyer who has
 * already been through the reply-first gate. Throwing would take a live marketplace's contact
 * reveal offline to protect a field nobody queries; storing NULL protects it completely, because
 * the thing you never wrote cannot leak.
 *
 * ⚠️ TO RESTORE THE SIGNAL, set CONTACT_IP_SALT in Secret Manager (eno-root-env) — 32+ random
 * bytes, e.g. `openssl rand -base64 32`. Nothing else has to change; hashing resumes on the next
 * deploy. Rotating it is free precisely because no stored value is ever compared: old and new
 * hashes never meet.
 */
const IP_SALT = process.env.CONTACT_IP_SALT || null

let warnedNoSalt = false

function hashIp(ip: string): string | null {
  if (!IP_SALT) {
    // Once per process, not per request: this is a config gap the operator must see, but it is on
    // the hot path of a user-facing reveal and must not become a log flood during an outage.
    if (!warnedNoSalt) {
      warnedNoSalt = true
      console.error('[contact] CONTACT_IP_SALT is unset — storing ipHash=null instead of a guessable digest')
    }
    return null
  }
  return crypto.createHash('sha256').update(IP_SALT + ip).digest('hex').slice(0, 32)
}

// Reveal a verified listing's seller contact — ONLY to an authenticated user.
// The phone never appears in any anonymous payload; it's delivered here after a
// JWT-revalidated getUser() check, rate-limited, and logged as a lead.
//
// ⚠️ WS6 — NOT MIGRATED. Two independent blockers, either one sufficient on its own, and both
// are about the guarantees this particular route exists to hold rather than about shape.
//
// 1. TWO LIMITERS, IN PARALLEL, BOTH FAIL-CLOSED. route() takes ONE static `rateLimit:` option.
//    Hoisting the per-user window and leaving the per-IP one in the handler is NOT equivalent,
//    because src/lib/ratelimit.ts increments the window on a DENIED attempt by design ("a DENIED
//    attempt still increments the window counter, so sustained hammering extends the throttle").
//    Today a caller over their 30/h user budget still burns their IP's 60/h; sequencing the two
//    would stop that and hand a harvester a cheaper retry. Weakening a throttle on a PII reveal
//    is not a refactor. The `strict: true` on BOTH is also load-bearing and is why they are here
//    at all — this is the canonical fail-closed route named in ratelimit.ts's own doc comment.
//
// 2. THE HANDLER NEEDS THE SUPABASE AUTH USER — not an id, and not a Profile. `user.email` and
//    `user.phone` feed metaUserDataFromHeaders() at the CAPI call below, and those are the
//    AUTH-CONFIRMED values. Profile.phone is writable without an OTP through PATCH /api/profile
//    (see the warning on getVerifiedPhone in src/lib/admin.ts), so `auth: 'profile'` would hash a
//    self-asserted number into the ad payload — and would add a Profile read plus a presence
//    heartbeat write to a reveal. `auth: 'userId'` is getClaims(): a LOCAL JWT check, which moves
//    revocation of a banned account from instant to token expiry (~1h) on the one endpoint that
//    hands out a seller's phone number. getUser() here is deliberate; the wrapper cannot say it.
//
// Branches: guest → 401 auth_required · either limiter (or a limiter outage, since both are
// strict) → 429 rate_limited · missing / unverified / out-of-edition listing → 404 not_found ·
// OFFICIAL PARTNER → 403 partner_chat_only · no conversation or no seller reply → 403
// reply_required · seller has no stored phone → 404 no_contact · success → 200
// {phone,telHref,zaloHref}. The $transaction is already try/caught, so there is no unhandled-throw
// branch for route() to improve on either.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  // getUser() revalidates the JWT with Supabase Auth (cookie sessions are spoofable).
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'auth_required' }, { status: 401 })

  const ip = clientIp(req)

  // Rate limit per user AND per IP (sliding window). Both must pass.
  const [byUser, byIp] = await Promise.all([
    rateLimit('contact:user', user.id, 30, '1 h', { strict: true }),
    rateLimit('contact:ip', ip, 60, '1 h', { strict: true }),
  ])
  if (!byUser.success || !byIp.success) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  // findFirst: this reveals a seller's PHONE NUMBER, so a desk listing must not resolve at all on
  // the licensed marketplace. The existing !verified check below already turns null into the 404.
  const listing = await db.listing.findFirst({
    where: await scopedListingWhere({ id }),
    select: { id: true, verified: true, seller: { select: { id: true, phone: true, officialPartner: true } } },
  })
  // Only verified (public) listings expose contact — never pending/hidden ones.
  if (!listing || !listing.verified) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // ── OFFICIAL PARTNER: there is no number to reveal, and saying so is not a leak. ──
  // ⚠️ KNOWN, DELIBERATE, AND NOT FREE: this sits BELOW the rate limiter, so a buyer who taps
  // "request contact" in a partner thread spends a strict 30/h contact-reveal slot on a request
  // that can never succeed — and ratelimit.ts increments on DENIED attempts by design, so the cost
  // is real. Reviewed and left as-is because the alternatives are both worse right now: hoisting
  // the partner check means a DB read BEFORE the limiter on the route that exists to resist
  // harvesting, and the proper fix is to stop offering the affordance at all — the thread's
  // `listing` payload carries no seller fields, so that means widening the conversations API and
  // editing messages/[id]/page.tsx, which is a landmine file. Bounded in practice: the buyer gets
  // an accurate answer on the first tap, so realistic burn is 1–2 of 30. Fix it with the UI change.
  // Checked HERE, ahead of the reply-first gate, for two reasons. It is the honest answer at any
  // reply state — a partner has no phone whether or not they have written back, so making the buyer
  // clear an unrelated gate first only to be refused is a worse experience for no security gain.
  // And it is 403, not the 404 `no_contact` below: those mean different things and the UI renders
  // them differently. 404 says "this seller hasn't added a number yet", which for a partner is
  // false and reads as a half-finished profile; 403 says eno declines by policy, which is the truth.
  // phoneForSeller() would return null for a partner anyway — this branch exists to name WHY.
  if (listing.seller.officialPartner) {
    return NextResponse.json({ error: 'partner_chat_only' }, { status: 403 })
  }

  // SECURITY GATE: reveal the number ONLY after a real in-app contact — the caller must
  // have a conversation with this seller for this listing AND the seller must have
  // replied (a message from the seller side). Listing IDs are public/enumerable, so
  // without this a single account could enumerate listings and harvest every seller's
  // phone (the "reply-first" rule was previously enforced only in the UI).
  const convo = await db.conversation.findUnique({
    where: { listingId_buyerProfileId: { listingId: id, buyerProfileId: user.id } },
    select: { id: true },
  })
  const sellerReplied = convo
    ? await db.message.findFirst({ where: { conversationId: convo.id, senderProfileId: { not: user.id } }, select: { id: true } })
    : null
  if (!sellerReplied) return NextResponse.json({ error: 'reply_required' }, { status: 403 })

  // Only the seller's REAL stored phone — never a synthetic/fallback number.
  // Pass the seller WHOLE. Handing over `{ phone }` alone is what the required `officialPartner`
  // field exists to stop — and it is what this line did until tsc refused it, on the one route
  // that hands out PII. The partner branch above already returned, so this is belt and braces;
  // the point is that the belt is now compiler-enforced for every future caller too.
  const phone = phoneForSeller(listing.seller)
  if (!phone) return NextResponse.json({ error: 'no_contact' }, { status: 404 })

  // Log the reveal once per (listing, viewer); bump contactCount only on a NEW row.
  // ATOMIC: the reveal row and the counter must commit together — otherwise a partial
  // failure (row created, increment lost) leaves the unique (listing,viewer) row in
  // place so every future reveal by this buyer hits P2002 and skips the bump forever,
  // permanently undercounting by 1. A P2002 on the create rejects the whole tx and is
  // handled by the catch below (already-revealed → no double count).
  try {
    await db.$transaction([
      db.contactReveal.create({
        data: { listingId: listing.id, viewerId: user.id, ipHash: hashIp(ip) },
      }),
      db.listing.update({ where: { id: listing.id }, data: { contactCount: { increment: 1 } } }),
    ])
    // New buyer lead → Meta CAPI Contact (server-side, after response flushes — zero
    // client cost; no-ops until CAPI env is set). Only on a NEW reveal (this try block).
    after(() =>
      sendMetaCapiEvent('Contact', {
        eventSourceUrl: req.headers.get('referer') || undefined,
        userData: metaUserDataFromHeaders(req.headers, { email: user.email, phone: user.phone, externalId: user.id }),
        customData: { content_ids: [listing.id], content_type: 'product' },
      }),
    )
  } catch (e: unknown) {
    // P2002 = already revealed by this viewer → no double count, still return contact.
    if (!(e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'P2002')) {
      console.error('[contact] log failed', e)
    }
  }

  return NextResponse.json({ phone, telHref: telHref(phone), zaloHref: zaloHref(phone) })
}
