import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { serializeListing } from '@/lib/serialize'
import { containsPhoneNumber } from '@/lib/phone'
import { createListingCore } from '@/lib/core/listings'
import { postingGate } from '@/lib/enforcement'
import { PublishBlockedError } from '@/lib/publish-guard'
import { resolveApiKey } from '@/lib/api/auth'
import { apiOk, apiAuthError } from '@/lib/api/respond'
import { withIdempotency } from '@/lib/api/idempotency'
import { parsePageParams, pageQuery, buildPage } from '@/lib/api/pagination'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/v1/listings — the authenticated shop's OWN listings, ALL statuses (active,
// sold, hidden, held). Keyset-paginated (?limit, ?cursor). Owner-scoped by the key's
// sellerId — a key can never read another shop's inventory.
export async function GET(req: NextRequest) {
  const r = await resolveApiKey(req, 'listings:read')
  if (!r.ok) return apiAuthError(r)

  const { limit, cursorId } = parsePageParams(req.nextUrl.searchParams)
  const rows = await db.listing.findMany({
    where: { sellerId: r.auth.sellerId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: { category: true, seller: { include: { owner: { select: { accountType: true } } } } },
    ...pageQuery(limit, cursorId),
  })
  const { items, nextCursor } = buildPage(rows, limit)
  return apiOk({ listings: items.map(serializeListing), next_cursor: nextCursor }, r.rate)
}

// POST /api/v1/listings — create a listing for the authenticated shop. Body: categorySlug,
// title, price, and the same optional fields the post wizard accepts (description, images,
// district, condition, listingType, subcategorySlug, attributes, brand, model, …). Runs
// the EXACT session create path via createListingCore (auto-publish gate, brand catalogue,
// translation warm, syndication, CAPI, reindex). Send an `Idempotency-Key` header to make
// retries safe. Scope: listings:write.
export async function POST(req: NextRequest) {
  const r = await resolveApiKey(req, 'listings:write')
  if (!r.ok) return apiAuthError(r)

  return withIdempotency(req, r.auth.keyId, r.rate, async () => {
    let body: Record<string, unknown>
    try { body = await req.json() } catch { return { status: 400, body: { error: { code: 'bad_request', message: 'Invalid JSON body.' } } } }

    const categorySlug = String(body.categorySlug || '').trim()
    const title = String(body.title || '').trim().slice(0, 140)
    const price = Number(body.price)
    if (!categorySlug || title.length < 3 || !Number.isFinite(price) || price < 0 || price > 1e12) {
      return { status: 422, body: { error: { code: 'invalid_input', message: 'categorySlug, a title (≥3 chars) and a valid price are required.' } } }
    }
    if (containsPhoneNumber(title) || containsPhoneNumber(String(body.description || ''))) {
      return { status: 422, body: { error: { code: 'no_phone_in_listing', message: 'Phone numbers are not allowed in the title or description.' } } }
    }
    const category = await db.category.findUnique({ where: { slug: categorySlug }, select: { id: true, slug: true, name: true, nameVi: true } })
    if (!category) return { status: 422, body: { error: { code: 'unknown_category', message: `Unknown category "${categorySlug}".` } } }
    const seller = await db.seller.findUnique({ where: { id: r.auth.sellerId }, select: { id: true, ownerId: true, trustTier: true, trustScore: true, phone: true } })
    if (!seller) return { status: 404, body: { error: { code: 'not_found', message: 'Shop not found.' } } }

    // ⚠️ THE ENFORCEMENT LADDER, AND ITS ABSENCE HERE WAS A HOLE IN THE FENCE. Both siblings in
    // this very directory run this gate and say so — bulk/route.ts:51 and sync/route.ts:37, each
    // citing "audit P0 #3: a held seller's pulled catalog must not be restorable through the API".
    // bulk's comment even calls it "the same gate single-listing POST runs", which was true of the
    // SESSION post path (api/listings/route.ts) and false of this one: the partner single-create
    // reached createListingCore with no gate at all. So a seller who was held or suspended — or a
    // probation account past its listing cap — was blocked on every surface except an API key.
    //
    // ⚠️ Not covered by the checks below it either: createListingCore's own refusals key on
    // `trustTier`, which is the TRUST axis. Enforcement writes `Profile.enforcementState`, a
    // different one; nothing here consulted it.
    if (seller.ownerId) {
      const gate = await postingGate(seller.ownerId, seller.id)
      if (gate) return { status: 403, body: { error: { code: gate.error, message: 'Posting is blocked for this account right now.' } } }
    }

    try {
      const created = await createListingCore({ seller, category, title, price, body, headers: req.headers })
      return { status: 201, body: { listing: created } }
    } catch (e) {
      // Same publish rules as the session post path: restricted shop / no photo / banned
      // words / contact info in text → a structured 422 (403 for the trust gate).
      if (e instanceof PublishBlockedError) {
        const message = e.code === 'account_restricted' ? 'Shop is restricted (low trust) — cannot publish until its score recovers.'
          : e.code === 'photo_required' ? 'At least one image is required.'
          : e.code === 'photos_min' ? 'At least 3 images from different angles are required (the same photo repeated counts as one).'
          : e.code === 'banned_words' ? 'The title or description contains a disallowed word.'
          : e.code === 'duplicate_listing' ? 'Duplicate of a live listing on this shop (see detail for its id) — update or bump the existing listing instead of re-posting it.'
          : 'Remove phone numbers, contact info or addresses from the title/description.'
        return { status: e.code === 'account_restricted' ? 403 : e.code === 'duplicate_listing' ? 409 : 422, body: { error: { code: e.code, message, ...(e.detail ? { detail: e.detail } : {}) } } }
      }
      throw e
    }
  })
}
