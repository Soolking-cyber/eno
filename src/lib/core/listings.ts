import 'server-only'
import { after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { reindexListing, removeFromIndex } from '@/lib/listing-index'
import { recordEngagement } from '@/lib/trust'
import { canBump } from '@/lib/stale'
import { containsPhoneNumber } from '@/lib/phone'
import { buildSearchText } from '@/lib/fold'
import { warmTranslations } from '@/lib/translate'
import { isListingImageUrl } from '@/lib/listing-image'
import { categoryHasBrand, resolveBrand, bumpBrandCount, enrichBrandLogoIfMissing } from '@/lib/brand'
import { rangeFacetsFor, subcategoriesFor, typesFor, suggestSubcategory } from '@/lib/taxonomy'
import { syndicateListing } from '@/lib/syndicate'
import { sendMetaCapiEvent, metaUserDataFromHeaders } from '@/lib/meta-capi'
import { dispatchListingEvent } from '@/lib/webhooks'
import { browseRankScore, recomputeRankScoreForListing } from '@/lib/ranking'
import { assertPublishable, assertCleanTexts, PublishBlockedError } from '@/lib/publish-guard'
import { findDuplicateListing } from '@/lib/duplicate-guard'
import { priceChangeEffects } from '@/lib/price-drop'
import { activateUrgentGate, urgentQuotaFree, URGENT } from '@/lib/urgent'

// ── Listing write-path "cores" (Phase 0 of the Partner API) ──────────────────────
// These hold the business logic for mutating a listing, decoupled from HOW the caller
// was authenticated. Each core takes EXPLICIT, already-authorized identifiers (a
// listingId the caller is proven to own, a profileId/sellerId) and NEVER reads the
// session implicitly — so the exact same logic serves the cookie-authed session routes
// AND a future API-key-authed /api/v1 (no second code path to drift). The caller does
// auth → core → serialize/respond. RLS is bypassed, so ownership MUST be checked by the
// caller (e.g. checkListingOwner) BEFORE invoking these. See docs/PARTNER-API-ROADMAP.md.

export const LISTING_STATUSES = new Set(['active', 'sold', 'hidden'])

/**
 * Set the availability status of an OWNED listing: 'active' (live) / 'sold' / 'hidden'
 * (pulled from the public feed, kept in the dashboard). Re-activating also stamps an
 * availability confirmation. Purges the cached detail page + (re)indexes for AI search.
 */
export async function setStatusCore(
  listingId: string,
  status: string,
): Promise<{ ok: true; status: string } | { ok: false; code: number; error: string }> {
  if (!LISTING_STATUSES.has(status)) return { ok: false, code: 400, error: 'invalid_status' }
  await db.listing.update({
    where: { id: listingId },
    data: { status, ...(status === 'active' ? { availabilityConfirmedAt: new Date() } : {}) },
  })
  revalidatePath(`/listings/${listingId}`) // sold/hidden must drop from the cached page (it 404s non-active)
  after(() => reindexListing(listingId)) // active → (re)index for AI search; sold/hidden → remove
  if (status === 'active') after(() => recomputeRankScoreForListing(listingId)) // re-decay on re-activation
  after(() => dispatchListingEvent('listing.status_changed', listingId, undefined, { status })) // notify the shop's partner webhooks
  return { ok: true, status }
}

/**
 * "Still available?" confirm — the Carousell-style bump. Marks the listing active,
 * stamps availabilityConfirmedAt, and (if outside the bump cooldown, per canBump)
 * refreshes feed recency (postedAt). A confirm inside the cooldown still records
 * availability (stops the reminder) but does NOT re-bump. `profileId` is the owner —
 * the day's activity earns a (daily-capped) trust reward. Intentionally does NOT
 * revalidate the cached page (recency surfaces live via the client feed).
 */
export async function confirmCore(listingId: string, profileId: string): Promise<{ ok: true; bumped: boolean }> {
  const now = new Date()
  const current = await db.listing.findUnique({ where: { id: listingId }, select: { postedAt: true, sellerTrustScore: true, featured: true, views: true, contactCount: true } })
  const bump = current ? canBump(current.postedAt, now.getTime()) : true
  await db.listing.update({
    where: { id: listingId },
    data: {
      status: 'active',
      availabilityConfirmedAt: now,
      // A bump resets recency (postedAt=now) → recompute rankScore at age 0 so the listing
      // jumps up immediately. No bump (within cooldown) leaves recency to the daily decay.
      ...(bump ? { postedAt: now, rankScore: browseRankScore({ sellerTrustScore: current?.sellerTrustScore ?? 100, postedAt: now, featured: current?.featured ?? false, views: current?.views ?? 0, contactCount: current?.contactCount ?? 0 }) } : {}),
    },
  })
  after(() => recordEngagement(profileId).catch(() => {})) // reward keeping listings fresh (daily-capped)
  return { ok: true, bumped: bump }
}

/**
 * Edit an OWNED listing (title/description/price/district/condition/images/subcategory/
 * intent/attributes/pin/brand/model/range specs). Category isn't editable. Re-runs the
 * create-time guards (phone-in-text block, image allowlist, taxonomy validation),
 * rebuilds searchText, re-publishes a held listing once it's eligible, and re-warms
 * translations + reindexes for AI search. `body` is the raw parsed JSON (sparse: only
 * present keys are touched). Returns a validation error code or { ok: true }.
 */
export async function updateListingCore(
  listingId: string,
  body: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; code: number; error: string }> {
  const current = await db.listing.findUnique({
    where: { id: listingId },
    select: {
      title: true, description: true, district: true, location: true, brandSlug: true, model: true, subcategorySlug: true, verified: true, images: true,
      // Price-drop pipeline + urgent gate inputs
      price: true, createdAt: true, sellerId: true, previousPrice: true, priceDropAt: true, lowestNotifiedPrice: true, priceDropNotifiedAt: true, urgentUntil: true,
      seller: { select: { trustTier: true } }, category: { select: { slug: true, name: true, nameVi: true } },
    },
  })
  if (!current) return { ok: false, code: 404, error: 'not_found' }

  const data: Record<string, unknown> = {}

  const title = body.title !== undefined ? String(body.title).trim().slice(0, 140) : undefined
  const description = body.description !== undefined ? String(body.description).trim().slice(0, 5000) : undefined
  const contactName = body.contactName !== undefined ? String(body.contactName).trim().slice(0, 80) : undefined

  if (title !== undefined) {
    if (title.length < 3) return { ok: false, code: 400, error: 'title_too_short' }
    data.title = title
    data.titleVi = null // drop the stale VI title; display falls back to the new EN title (re-warmed below)
  }
  if (description !== undefined) data.description = description

  // Phone numbers are never allowed in public text (same rule as create).
  if (containsPhoneNumber(title ?? '') || containsPhoneNumber(description ?? '') || containsPhoneNumber(contactName ?? '')) {
    return { ok: false, code: 400, error: 'no_phone_in_listing' }
  }

  if (body.price !== undefined) {
    const price = Number(body.price)
    if (!Number.isFinite(price) || price < 0 || price > 1e12) return { ok: false, code: 400, error: 'invalid_price' }
    data.price = price
  }
  if (body.district !== undefined) {
    const district = body.district ? String(body.district).trim().slice(0, 80) : null
    data.district = district
    // Don't stomp the listing's city with a hardcoded "Ho Chi Minh City" (wrong for
    // every non-HCMC listing). Use the new district as the display location; if it's
    // cleared, keep the existing location (a non-nullable column — never write null).
    data.location = district || current.location
  }
  if (body.condition !== undefined) data.condition = body.condition ? String(body.condition).trim().slice(0, 60) : null
  // Price-negotiable toggle (edit): honored on the same edit path the wizard resubmits.
  if (body.negotiable !== undefined) data.negotiable = Boolean(body.negotiable)
  // Urgent-sale toggle (edit). Activation runs the full server gate (no-op while
  // already active — never a silent renewal; 7-day re-arm cooldown; 2-per-seller
  // quota) and force-enables offers — urgency IS a promise of flexibility. An early
  // switch-OFF stamps urgentUntil=now (not null): the past value anchors the
  // cooldown so off/on cycling can't keep a listing permanently urgent.
  if (body.urgent !== undefined) {
    if (body.urgent === true || body.urgent === 'true') {
      const gate = await activateUrgentGate({ id: listingId, sellerId: current.sellerId, urgentUntil: current.urgentUntil })
      // Over quota is worth telling the seller (409). Cooldown is NOT fatal to the
      // edit: the wizard prefills urgent=true for a listing that was active at open,
      // and it may expire mid-edit — failing the whole (price/photo) edit over a stale
      // chip resend would be maddening. So a cooldown just skips re-arming the chip.
      if (gate.ok === false) { if (gate.error === 'urgent_quota') return { ok: false, code: 409, error: gate.error } }
      else if (gate.ok === true) { data.urgentUntil = gate.urgentUntil; data.negotiable = true }
    } else if (current.urgentUntil && current.urgentUntil.getTime() > Date.now()) {
      data.urgentUntil = new Date()
    }
  }
  // Fixed price and urgent are mutually exclusive — urgency promises flexibility. If
  // this edit sets a fixed price on a still-urgent listing (and didn't just activate
  // urgent, which forces negotiable=true above), end the urgent run — mirrors the
  // wizard, where picking "Fixed price" clears the urgent chip.
  if (data.negotiable === false && data.urgentUntil === undefined && current.urgentUntil && current.urgentUntil.getTime() > Date.now()) {
    data.urgentUntil = new Date()
  }
  if (Array.isArray(body.images)) {
    const images = (body.images as unknown[]).filter(isListingImageUrl).slice(0, 8)
    data.images = JSON.stringify(images)
  }

  // Subcategory — must belong to the listing's (unchanged) category.
  if (body.subcategorySlug !== undefined) {
    const sc = body.subcategorySlug ? String(body.subcategorySlug).trim() : null
    if (!sc || subcategoriesFor(current.category.slug).some((s) => s.slug === sc)) data.subcategorySlug = sc
  }
  // Intent (listingType) — must be valid for the category.
  if (body.listingType !== undefined) {
    const lt = String(body.listingType).trim()
    if ((typesFor(current.category.slug) as string[]).includes(lt)) data.listingType = lt
  }
  // Attribute facets — whitelisted stringly-typed taxonomy values (same rule as create).
  if (body.attributes !== undefined) {
    const clean: Record<string, string> = {}
    if (body.attributes && typeof body.attributes === 'object' && !Array.isArray(body.attributes)) {
      for (const [k, v] of Object.entries(body.attributes as Record<string, unknown>)) {
        if (typeof v === 'string' && v && /^[a-z0-9_]+$/i.test(k)) clean[k] = v.slice(0, 40)
      }
    }
    data.attributes = Object.keys(clean).length ? JSON.stringify(clean) : null
  }
  // Precise pin from "use my current location".
  if (body.city !== undefined && body.city) data.city = String(body.city).trim().slice(0, 80)
  if (body.lat !== undefined) { const n = Number(body.lat); data.lat = Number.isFinite(n) && n >= -90 && n <= 90 ? n : null }
  if (body.lng !== undefined) { const n = Number(body.lng); data.lng = Number.isFinite(n) && n >= -180 && n <= 180 ? n : null }

  // Brand edit (product categories only) — re-resolve into the catalogue and move
  // the listing-count from the old brand to the new one. Best-effort; never blocks.
  let brandChange: { from: string | null; to: string | null } | null = null
  if (body.brand !== undefined && categoryHasBrand(current.category.slug)) {
    const raw = body.brand ? String(body.brand) : ''
    const next = raw.trim() ? await resolveBrand(raw).catch(() => null) : null
    if (next !== current.brandSlug) {
      data.brandSlug = next
      brandChange = { from: current.brandSlug, to: next }
      if (!next) data.model = null // brand cleared → model is meaningless
    }
  }
  // Model edit (product categories only) — kept alongside a brand.
  if (body.model !== undefined && categoryHasBrand(current.category.slug)) {
    const effectiveBrand = (data.brandSlug as string | null | undefined) ?? current.brandSlug
    data.model = effectiveBrand && body.model ? (String(body.model).trim().slice(0, 60) || null) : null
  }

  // Range specs (year/mileage/engine) → clamped to the category's declared range.
  // An explicit null/'' clears the spec; an omitted key leaves it untouched.
  for (const f of rangeFacetsFor(current.category.slug, current.subcategorySlug)) {
    const col = f.range.column
    if (body[col] === undefined) continue
    if (body[col] === null || body[col] === '') { data[col] = null; continue }
    const raw = Number(body[col])
    if (!Number.isFinite(raw)) continue
    const clamped = Math.min(Math.max(raw, f.range.min), f.range.max)
    data[col] = col === 'engineL' ? Math.round(clamped * 10) / 10 : Math.round(clamped)
  }

  if (Object.keys(data).length === 0) return { ok: true }

  // Full content screen on EVERY edited free-text field — the same checks as
  // create. Without this, clean-publish-then-edit was a complete bypass of the
  // banned-goods and contact filters (2026-07-06 compliance verification). Covers
  // the secondary fields too (model/condition/district/city/attribute values —
  // all publicly rendered).
  try {
    const attrTexts = data.attributes ? Object.values(JSON.parse(data.attributes as string) as Record<string, string>) : []
    assertCleanTexts([
      title, description, contactName,
      data.district as string | null | undefined,
      data.condition as string | null | undefined,
      data.model as string | null | undefined,
      data.city as string | null | undefined,
      body.brand !== undefined ? String(body.brand ?? '') : undefined,
      ...attrTexts,
    ])
  } catch (e) {
    if (e instanceof PublishBlockedError) {
      return { ok: false, code: 400, error: e.code === 'banned_words' ? 'banned_words' : 'no_phone_in_listing' }
    }
    throw e
  }

  // Rebuild the folded search blob from the new values (fall back to current).
  const newTitle = (data.title as string) ?? current.title
  const newDesc = (data.description as string) ?? current.description
  const newDistrict = (data.district as string | null) ?? current.district
  const newBrand = (data.brandSlug as string | null | undefined) ?? current.brandSlug
  const newModel = (data.model as string | null | undefined) ?? current.model
  data.searchText = buildSearchText([newTitle, newDesc, newDistrict, current.category.name, current.category.nameVi, newBrand, newModel])

  // Republish a HELD listing (verified=false — it was photoless or the seller was
  // Restricted) the moment it becomes eligible again: adding a photo to a held listing
  // must make it public, not leave it dead inventory (manual moderation was removed).
  // The publish gate mirrors create: >=1 image AND a non-restricted seller.
  if (current.verified === false && current.seller?.trustTier !== 'restricted') {
    let imgs: string[] = []
    try { imgs = data.images !== undefined ? JSON.parse(data.images as string) : JSON.parse(current.images || '[]') } catch { imgs = [] }
    if (imgs.length >= 1) data.verified = true
  }

  // Price-drop pipeline — runs LAST, once every validation above has passed, so a
  // rejected edit never writes an audit row. Reads history, computes the 30-day-min
  // reference, merges the badge fields (for a qualifying drop), and hands back the
  // audit-row payload + the buyer-notification thunk. A raise clears any active badge
  // instantly. All rules in src/lib/price-drop.ts.
  let dropNotify: (() => Promise<void>) | null = null
  let dropAudit: { listingId: string; oldPrice: number; newPrice: number } | null = null
  if (data.price !== undefined && (data.price as number) !== current.price) {
    const effects = await priceChangeEffects(
      {
        id: listingId,
        price: current.price,
        createdAt: current.createdAt,
        previousPrice: current.previousPrice,
        priceDropAt: current.priceDropAt,
        lowestNotifiedPrice: current.lowestNotifiedPrice,
        priceDropNotifiedAt: current.priceDropNotifiedAt,
      },
      data.price as number,
    )
    Object.assign(data, effects.data)
    dropNotify = effects.notify
    dropAudit = effects.audit
  }

  // Commit the audit row and the listing update ATOMICALLY — a failed update must not
  // leave a phantom PriceChange (it would drag the 30-day reference down and mis-anchor
  // the "was" price on a future drop). Plain update when the price didn't change.
  if (dropAudit) {
    await db.$transaction([
      db.priceChange.create({ data: dropAudit }),
      db.listing.update({ where: { id: listingId }, data }),
    ])
  } else {
    await db.listing.update({ where: { id: listingId }, data })
  }
  if (dropNotify) after(dropNotify) // buyer fan-out never delays the response
  if (brandChange) after(() => Promise.all([
    brandChange!.from ? bumpBrandCount(brandChange!.from, -1) : Promise.resolve(),
    brandChange!.to ? bumpBrandCount(brandChange!.to, 1) : Promise.resolve(),
  ]))
  revalidatePath(`/listings/${listingId}`) // purge the cached (ISR) detail page so the edit shows
  after(() => reindexListing(listingId)) // refresh the AI-search document with the edited fields
  after(() => dispatchListingEvent('listing.updated', listingId)) // notify the shop's partner webhooks

  // Re-warm translations for any changed user text (after the response flushes).
  const warm = [data.title as string, data.description as string, data.location as string].filter(Boolean)
  if (warm.length) after(() => warmTranslations(warm))

  return { ok: true }
}

/**
 * Build + create a listing for an ALREADY-RESOLVED seller, then fire the after()
 * side-effects (brand catalogue, translation warm, social syndication + Meta CAPI Lead
 * + AI-search index when it publishes live). The caller has already: parsed the body,
 * hard-validated title/price/phone-in-text, looked up the category, and resolved the
 * seller (by-phone for the session post wizard; by-API-key for /api/v1). This core owns
 * the field-building, the auto-publish gate, the create, and the side-effects so both
 * paths produce IDENTICAL listings. `headers` powers CAPI user-matching + event source.
 */
export async function createListingCore(input: {
  seller: { id: string; trustTier: string; trustScore: number; phone: string | null }
  category: { id: string; slug: string; name: string; nameVi: string }
  title: string
  price: number
  body: Record<string, unknown>
  headers: Headers
}): Promise<{ id: string; verified: boolean }> {
  const { seller, category, title, price, body, headers } = input
  const categorySlug = category.slug

  const images: string[] = Array.isArray(body.images)
    ? (body.images as unknown[]).filter(isListingImageUrl).slice(0, 8)
    : []
  const district = body.district ? String(body.district).trim().slice(0, 80) : null
  const city = body.city ? String(body.city).trim().slice(0, 80) : 'Ho Chi Minh City'
  const location = body.location ? String(body.location).trim().slice(0, 120) : (district || city)
  // Optional precise pin from "use my current location" (validated to plausible ranges).
  const latNum = Number(body.lat), lngNum = Number(body.lng)
  const lat = Number.isFinite(latNum) && latNum >= -90 && latNum <= 90 ? latNum : null
  const lng = Number.isFinite(lngNum) && lngNum >= -180 && lngNum <= 180 ? lngNum : null

  // Publish gate — NO held-for-review queue (manual verification removed; nothing waits on
  // an admin). A Restricted (low-trust) account can't post until its score recovers; a
  // missing photo / banned words / contact info in the text are REJECTED so the seller fixes
  // them (the wizard maps these codes to inline messages). Throws PublishBlockedError; the
  // caller turns it into an HTTP error. Pass → the listing goes live instantly.
  const description = String(body.description || '').trim().slice(0, 5000)
  const guardName = body.contactName ? String(body.contactName).trim().slice(0, 80) : null
  assertPublishable({ trustTier: seller.trustTier, images, texts: [title, description, guardName] })

  // Intent + subcategory from the taxonomy. listingType must be valid for the category
  // (else its primary type); subcategory falls back to keyword-suggest.
  const allowedTypes = typesFor(categorySlug) as string[]
  const reqType = String(body.listingType || '').trim()
  const listingType = allowedTypes.includes(reqType) ? reqType : allowedTypes[0]
  const subs = subcategoriesFor(categorySlug)
  let subcategorySlug: string | null = String(body.subcategorySlug || '').trim()
  if (!subs.some((s) => s.slug === subcategorySlug)) {
    subcategorySlug = suggestSubcategory(categorySlug, `${title} ${body.description || ''}`) || (subs[0]?.slug ?? null)
  }
  // Price unit follows the intent (monthly for rent/job, per-service for service).
  const priceUnit = listingType === 'rent' || listingType === 'job' ? 'VND/month'
    : listingType === 'service' ? 'VND/service (from)' : 'VND'
  // Whitelisted, stringly-typed attribute facets (taxonomy values).
  let attributes: string | null = null
  if (body.attributes && typeof body.attributes === 'object' && !Array.isArray(body.attributes)) {
    const clean: Record<string, string> = {}
    for (const [k, v] of Object.entries(body.attributes as Record<string, unknown>)) {
      if (typeof v === 'string' && v && /^[a-z0-9_]+$/i.test(k)) clean[k] = v.slice(0, 40)
    }
    if (Object.keys(clean).length) attributes = JSON.stringify(clean)
  }

  // Structured numeric specs (range facets) → dedicated columns, each clamped to the
  // category's declared range. Engine keeps one decimal (litres); year/mileage integers.
  const rangeData: Record<string, number> = {}
  for (const f of rangeFacetsFor(categorySlug, subcategorySlug)) {
    const raw = Number((body as Record<string, unknown>)[f.range.column])
    if (!Number.isFinite(raw)) continue
    const clamped = Math.min(Math.max(raw, f.range.min), f.range.max)
    rangeData[f.range.column] = f.range.column === 'engineL' ? Math.round(clamped * 10) / 10 : Math.round(clamped)
  }

  // Brand (product categories only): canonicalize + typo-dedupe into the catalogue,
  // growing it on first sight. Never blocks the post if resolution fails.
  let brandSlug: string | null = null
  if (categoryHasBrand(categorySlug) && body.brand) {
    try { brandSlug = await resolveBrand(String(body.brand)) } catch { brandSlug = null }
  }
  // Specific model — only kept alongside a resolved brand.
  const model = brandSlug && body.model ? (String(body.model).trim().slice(0, 60) || null) : null

  // Urgent-sale chip at posting. Quota-gated (max 2 concurrently urgent per seller) —
  // but NEVER fails the post over a chip: over quota, the listing is simply created
  // without it (the seller can re-arm from edit once a slot frees). No cooldown check
  // here — a brand-new listing has no urgent history.
  const urgentOk = (body.urgent === true || body.urgent === 'true') && (await urgentQuotaFree(seller.id))

  // Screen the SECONDARY free-text fields too (all publicly rendered): district,
  // condition, model, raw brand input, city, LOCATION, attribute values. The primary
  // texts were screened by assertPublishable above; without this a banned term or
  // phone number could ride in via e.g. `model` or the free-text `location` (which
  // is card/detail-rendered AND auto-syndicated to Telegram/Facebook, so a direct-
  // or partner-API caller could smuggle "Zalo 090… - bán súng đạn" past the gate —
  // 2026-07-06 launch audit; the UI wizard sends controlled geo names).
  const conditionText = body.condition ? String(body.condition).trim().slice(0, 60) : null
  assertCleanTexts([
    district, conditionText, model, city, location,
    body.brand ? String(body.brand) : undefined,
    ...(attributes ? Object.values(JSON.parse(attributes) as Record<string, string>) : []),
  ])

  // Duplicate-listing protection: the same product can't be posted again while a copy of
  // it is still LIVE (repost-to-bump spam). Re-listing after sold/hidden/deleted is fine,
  // and the check is seller-scoped so nobody is blocked by other sellers' items. The
  // candidate searchText uses the exact recipe of the create below. detail = the existing
  // listing's id so clients can link "edit / bump it instead". Fail-open inside the guard.
  const searchText = buildSearchText([title, String(body.description || ''), district, category.name, category.nameVi, brandSlug, model])
  const dup = await findDuplicateListing({ sellerId: seller.id, categoryId: category.id, title, searchText, price, images })
  if (dup) throw new PublishBlockedError('duplicate_listing', dup.id)

  const listing = await db.listing.create({
    data: {
      title,
      description,
      price,
      priceUnit,
      currency: '₫',
      // Default to negotiable when the caller omits it (matches the column default +
      // the pre-feature norm); the wizard sends an explicit true/false, partner API /
      // MCP send it when they want a fixed price. Urgent force-enables offers —
      // urgency is a promise of flexibility (the wizard mirrors this client-side).
      negotiable: urgentOk ? true : body.negotiable === undefined ? true : Boolean(body.negotiable),
      ...(urgentOk ? { urgentUntil: new Date(Date.now() + URGENT.DURATION_MS) } : {}),
      location,
      district,
      city,
      lat,
      lng,
      condition: conditionText,
      images: JSON.stringify(images),
      searchText, // built above (same recipe the duplicate guard compared against)
      categoryId: category.id,
      subcategorySlug,
      listingType,
      attributes,
      ...rangeData,
      brandSlug,
      model,
      sellerId: seller.id,
      sellerTrustScore: seller.trustScore, // denormalized ranking key (kept in sync by src/lib/trust.ts)
      // Balanced feed rank at age≈0 (recency=1) — matches the SQL re-decay exactly. New
      // listings land fresh; the daily cron + trust changes re-decay it afterwards.
      rankScore: browseRankScore({ sellerTrustScore: seller.trustScore, postedAt: new Date(), featured: false }),
      verified: true,
    },
  })
  if (brandSlug) after(() => { bumpBrandCount(brandSlug!); enrichBrandLogoIfMissing(brandSlug!).catch(() => {}) })

  // Pre-translate every user-authored text field into ALL supported languages so the
  // listing renders from cache in any visitor's language. Runs after the response flushes.
  const attrValues: string[] = (() => {
    try {
      const a = listing.attributes ? JSON.parse(listing.attributes) : {}
      return Object.values(a).map((v) => String(v))
    } catch { return [] }
  })()
  const warmFields = [listing.title, listing.description, listing.location, ...attrValues].filter(Boolean)
  after(() => warmTranslations(warmFields))

  // Auto cross-post to social channels + Meta CAPI Lead + AI-search index. Every created
  // listing is now live (the publish gate REJECTS instead of holding), so this always runs.
  // Best-effort, after the response.
  {
    after(() => syndicateListing({
      id: listing.id,
      title: listing.title,
      price: listing.price,
      currency: listing.currency,
      location: listing.location,
      district: listing.district,
      image: images[0] || null,
      categoryName: category.name,
    }))
    after(() =>
      sendMetaCapiEvent('Lead', {
        eventSourceUrl: headers.get('referer') || undefined,
        userData: metaUserDataFromHeaders(headers, { phone: seller.phone, externalId: seller.id }),
        customData: { content_ids: [listing.id], content_type: 'product', content_category: category.name, value: listing.price, currency: 'VND' },
      }),
    )
    after(() => reindexListing(listing.id)) // add the new live listing to AI search
  }

  after(() => dispatchListingEvent('listing.created', listing.id, seller.id)) // notify the shop's partner webhooks
  return { id: listing.id, verified: true }
}

/** Delete an OWNED listing (cascades reports/conversations); decrements its brand
 *  count, purges the cached page, and drops it from AI search. */
export async function deleteListingCore(listingId: string): Promise<{ ok: true }> {
  const gone = await db.listing.findUnique({ where: { id: listingId }, select: { brandSlug: true, sellerId: true } })
  await db.listing.delete({ where: { id: listingId } })
  if (gone?.brandSlug) after(() => bumpBrandCount(gone.brandSlug!, -1))
  revalidatePath(`/listings/${listingId}`)
  after(() => removeFromIndex(listingId)) // drop the deleted listing from AI search
  if (gone?.sellerId) after(() => dispatchListingEvent('listing.deleted', listingId, gone.sellerId!)) // the listing is gone — pass sellerId explicitly
  return { ok: true }
}
