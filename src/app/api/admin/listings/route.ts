import { NextResponse } from 'next/server'
import { revalidatePublicPath } from '@/lib/revalidate-lang'
import { db } from '@/lib/db'
import { route } from '@/lib/api/handler'
import { bumpBrandCount } from '@/lib/brand'
import { fold } from '@/lib/fold'
import { LISTING_CARD_SELECT, serializeListingCard } from '@/lib/serialize'
import { partitionByIdentityGate, settleHolds } from '@/lib/compliance/seller-publish-gate'
import { refreshListingSurfaces } from '@/lib/listing-surfaces'

export const dynamic = 'force-dynamic'

// Admin listings tool — browse + batch-act on listings. Every action re-checks
// getAdmin(). GET lists (search/status/verified filters, paginated); POST runs a
// batch action over selected ids.

// ⚠️ WS6 MIGRATION — THE AUTH PREAMBLE ONLY, ON BOTH METHODS. `auth: 'admin'` emits exactly the
// `{"error":"Forbidden"}` 403 both `if (!(await getAdmin()))` lines emitted, capital F included.
// Neither method used the admin's email, so nothing is destructured from ctx beyond `req`.
//
// ⚠️ NO `body:` SCHEMA ON POST, AND THE REASON IS THE HAND-COERCION. Today `{"ids":"abc"}` and
// `{"ids":[1,2]}` both survive `Array.isArray(...) ? filter(typeof x === 'string') : []` and land on
// `{"error":"no_ids"}` 400; a zod schema would answer `bad_request` 400 instead. Same status, a
// different code on the wire — so the tolerant parse stays. Malformed JSON already answers
// `bad_request` 400 and keeps doing so from the same try/catch.
//
// ⚠️ NO `rateLimit:` — there was none. GET's query-string coercion also stays put: route() has no
// searchParams option and this migration adds no validation it did not have.
//
// GET branches held: guest / non-admin → 403 `{"error":"Forbidden"}` · any q/status/verified/limit/
// offset combination → 200 `{listings,total}` (limit clamped 1..100, offset ≥ 0, unchanged).
// POST branches held: guest / non-admin → 403 `{"error":"Forbidden"}` · malformed JSON → 400
// `{"error":"bad_request"}` · no usable ids → 400 `{"error":"no_ids"}` · unrecognised action → 400
// `{"error":"bad_action"}` · success → 200 `{"ok":true,"affected":n}` (+ `"held":h` when the seller identity
// gate parked any in this request, + `"alreadyHeld":k` when the batch included rows it had parked before
// — neither ever appears while IDENTITY_GATE_ENFORCED is off, so the off-state body is unchanged).
//
// ⚠️ ONE BRANCH IS NOT BYTE-IDENTICAL, ON EACH METHOD: neither had a try/catch around its Prisma
// calls, so a DB rejection (GET's findMany/count, POST's deleteMany/updateMany, or bumpBrandCount)
// used to reach Next's default 500 HTML and now returns `{"error":"internal_error"}` 500, logged
// with an `op`. Accepted improvement, declared rather than claimed away.
export const GET = route({ auth: 'admin' }, async ({ req }) => {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q')?.trim()
  const status = searchParams.get('status') // active | hidden | sold | all
  const verified = searchParams.get('verified') // true | false | all
  const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 50, 1), 100)
  const offset = Math.max(Number(searchParams.get('offset')) || 0, 0)

  const AND: Record<string, unknown>[] = []
  if (q) AND.push({ searchText: { contains: fold(q) } })
  if (status && status !== 'all') AND.push({ status })
  if (verified === 'true') AND.push({ verified: true })
  else if (verified === 'false') AND.push({ verified: false })
  const where = AND.length ? { AND } : {}

  // ⚠️ CARD serializer + CARD select, matched ON PURPOSE. This handler used to feed
  // serializeListing (the FULL-listing serializer) a seller narrowed to {name,
  // trustScore} behind an `as never` — the serializer's `seller.memberSince
  // .toISOString()` then threw on EVERY request, a deterministic 500 the cast had
  // silenced since the two shipped together. Nothing e2e-opens this queue, so it
  // surfaced only when the desk did (prod 5xx alert, 2026-07-23). The card
  // projection carries everything this table renders; the admin extras ride the row.
  const [rows, total] = await Promise.all([
    db.listing.findMany({
      where,
      select: {
        ...LISTING_CARD_SELECT,
        status: true,
        featured: true,
        createdAt: true,
        seller: { select: { name: true, trustScore: true, officialPartner: true, owner: { select: { accountType: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    db.listing.count({ where }),
  ])

  const listings = rows.map((r) => {
    const l = serializeListingCard(r)
    return { id: l.id, title: l.titleVi || l.title, price: l.price, currency: l.currency, image: l.images[0] ?? null, status: r.status, verified: r.verified, featured: r.featured, sellerName: r.seller.name, category: l.category.name, createdAt: r.createdAt.toISOString() }
  })
  return NextResponse.json({ listings, total })
})

export const POST = route({ auth: 'admin' }, async ({ req }) => {
  let body: { action?: string; ids?: string[] }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400 }) }
  const ids = Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === 'string').slice(0, 500) : []
  if (!ids.length) return NextResponse.json({ error: 'no_ids' }, { status: 400 })

  let affected = 0
  // Listings the seller identity gate PARKED instead of publishing (activate/verify only, gate on
  // only). Reported so the console can say "published 8 · 2 held until the seller verifies" rather
  // than letting an operator believe all ten went live. Always 0 while the gate is off.
  // ⚠️ `held` IS WHAT THIS REQUEST PARKED — the ids the park write itself returned, less any the
  // re-check released — never a count derived from the decision set. Deriving it from the set
  // counted rows the WHERE guard skipped, and handing that set to settleHolds let a PRE-EXISTING
  // hold released by the re-check cancel out one parked here: "2 activated, 0 held", with the
  // parked row visible nowhere.
  let held = 0
  // Rows in the batch that were ALREADY parked (verified=false, identityHold=true) before this
  // request. They are neither "activated/published" (they are not public, and this request did not
  // make them so) nor "held" (this request did not park them) — so they get their own count, and the
  // console says they are still waiting on the seller. Always 0 while the gate is off.
  let alreadyHeld = 0
  switch (body.action) {
    case 'delete': {
      // Decrement brand counts for any branded listings before they're gone.
      const branded = await db.listing.findMany({ where: { id: { in: ids }, brandSlug: { not: null } }, select: { brandSlug: true } })
      const byBrand = new Map<string, number>()
      for (const b of branded) if (b.brandSlug) byBrand.set(b.brandSlug, (byBrand.get(b.brandSlug) ?? 0) + 1)
      const res = await db.listing.deleteMany({ where: { id: { in: ids } } })
      affected = res.count
      await Promise.all([...byBrand].map(([slug, n]) => bumpBrandCount(slug, -n)))
      break
    }
    case 'hide': affected = (await db.listing.updateMany({ where: { id: { in: ids } }, data: { status: 'hidden' } })).count; break
    case 'activate': {
      // ⚖️ Activating a VERIFIED row that is not live yet publishes it, so for an owner the identity
      // gate refuses that row is parked instead: the status the admin asked for is applied, with
      // verified→false + identityHold→true until they verify. Two kinds of gated row are NOT parked:
      //   · already unverified — not public either way; giving it identityHold would turn a
      //     moderator's takedown into something verifying undoes.
      //   · already active AND verified — already public. The gate governs ENTERING public state; an
      //     "activate" that changes nothing must not quietly become a takedown.
      const { allowed, held: gated } = await partitionByIdentityGate(ids)
      affected = allowed.length ? (await db.listing.updateMany({ where: { id: { in: allowed } }, data: { status: 'active' } })).count : 0
      if (gated.length) {
        // ⚠️ THE UNPARKED ROWS FIRST: once a row is parked it is itself `verified: false`, and running
        // this second would match it again and double-count. The two WHEREs are disjoint as ordered.
        // An ALREADY-parked row lands here too (it is unverified): its status is applied, so it goes
        // live as the admin asked once the seller verifies — but it is counted as `alreadyHeld`, not
        // as affected. The returned flags are the rows' own, untouched by this status-only write.
        const rest = await db.listing.updateManyAndReturn({ where: { id: { in: gated }, OR: [{ verified: false }, { status: 'active' }] }, data: { status: 'active' }, select: { verified: true, identityHold: true } })
        const parked = (await db.listing.updateManyAndReturn({ where: { id: { in: gated }, verified: true, status: { not: 'active' } }, data: { status: 'active', verified: false, identityHold: true }, select: { id: true } })).map((r) => r.id)
        // A verification that landed between the decision and the park is released here (see
        // settleHolds); those rows went live after all, so they count as affected, not held. Only
        // the ids parked HERE are re-checked, so only they can be counted as released.
        const released = parked.length ? await settleHolds(parked) : 0
        held = parked.length - released
        alreadyHeld = rest.filter((r) => !r.verified && r.identityHold).length
        // ⚠️ `affected` NEVER INCLUDES A PARKED ROW — in both gated actions. It means "took effect as
        // asked", exactly as it does for an owner the gate allows; parked rows are reported as `held`
        // alongside, so "activate · 8 · 2 held" and "verify · 8 · 2 held" mean the same thing for the
        // same ten ids. Of the rows the gate intercepted, only the ones this request parked AND then
        // itself released went public because of it, so only those join `affected`.
        affected += rest.length - alreadyHeld + released
      }
      break
    }
    case 'feature': affected = (await db.listing.updateMany({ where: { id: { in: ids } }, data: { featured: true } })).count; break
    case 'unfeature': affected = (await db.listing.updateMany({ where: { id: { in: ids } }, data: { featured: false } })).count; break
    case 'verify': {
      // ⚖️ "Publish" — for an owner the identity gate refuses, the admin's approval is recorded as a
      // HOLD (identityHold) and becomes a publish the moment they verify. Never a silent no-op.
      // A gated row that is ALREADY verified is left exactly as it is (counted, not rewritten): the
      // gate governs entering public state, and re-verifying must not turn into a takedown.
      const { allowed, held: gated } = await partitionByIdentityGate(ids)
      // `identityHold: false` rides the publish: a row parked earlier (the gate was on and has since
      // been switched off, or the owner verified and the release missed it) must not go live still
      // carrying a hold. Only the response is pinned byte-identical with the gate off — this column
      // is already false on every row the gate never touched.
      affected = allowed.length ? (await db.listing.updateMany({ where: { id: { in: allowed } }, data: { verified: true, identityHold: false } })).count : 0
      if (gated.length) {
        // Read BEFORE the park and the re-check: afterwards a parked row and a pre-existing hold look
        // the same, and a pre-existing hold the re-check released would look "already verified".
        const before = await db.listing.findMany({ where: { id: { in: gated } }, select: { verified: true, identityHold: true } })
        alreadyHeld = before.filter((r) => !r.verified && r.identityHold).length
        // `identityHold: false` in the WHERE: an already-parked row is not parked again, so it can
        // never be counted as held by this request.
        const parked = (await db.listing.updateManyAndReturn({ where: { id: { in: gated }, verified: false, identityHold: false }, data: { identityHold: true }, select: { id: true } })).map((r) => r.id)
        const released = parked.length ? await settleHolds(parked) : 0
        held = parked.length - released
        // Already verified (left as asked, as the allowed path counts it) + parked-then-released here.
        affected += before.filter((r) => r.verified).length + released
      }
      break
    }
    // ⛔ A TAKEDOWN CLEARS identityHold TOO — otherwise a listing parked by the identity gate and then
    // pulled here would be republished by releaseIdentityHolds() the day its seller verifies.
    case 'unverify': affected = (await db.listing.updateMany({ where: { id: { in: ids } }, data: { verified: false, identityHold: false } })).count; break
    default: return NextResponse.json({ error: 'bad_action' }, { status: 400 })
  }

  revalidatePublicPath('/')
  // ⛔ EACH LISTING'S OWN PAGE TOO. This purged only "/", so a bulk hide/delete/unverify of scam or
  // illegal stock kept every PDP serving for up to the 30-day ISR window — and a bulk verify/activate
  // kept serving the cached 404/sold page. The helper also re-syncs AI search (upsert if still
  // public, else drop), which is what the after(reindex) here used to do on its own.
  refreshListingSurfaces(ids, 'admin.listings')
  // `held` / `alreadyHeld` only when non-zero, so with the gate off the body is byte-for-byte what it
  // always was.
  return NextResponse.json({ ok: true, affected, ...(held ? { held } : {}), ...(alreadyHeld ? { alreadyHeld } : {}) })
})
