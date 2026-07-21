// ── Seed the eno e-VISA SHOP (idempotent) ──────────────────────────────────────────
//
// "Visa in a DM" starts with the user picking a PRODUCT, so the visa desk has to exist
// as an ordinary marketplace storefront: a Seller owned by support@eno.vn plus one
// verified listing per visa product. This script creates/reconciles exactly that, and
// nothing else. Re-running it never duplicates a listing — every product is keyed on
// `Listing.externalId` (unique per seller), so a second run UPDATES the same rows.
//
//   node --env-file=.env scripts/seed-visa-shop.mjs --price-usd=25
//   npx tsx scripts/seed-visa-shop.mjs --dry-run        # also runs the publish-gate self-check
//
// Flags
//   --price-usd=N     price for EVERY product, in WHOLE USD (see "Money" below)
//   --image=<url>     artwork for every product (skips the local-file upload)
//   --allow-no-image  seed a product with no photo (dev/staging only — see "Artwork")
//   --force           overwrite listing copy/price/status that was edited in the dashboard
//   --status=hidden   seed the listings out of the public feed (default: active)
//   --dry-run         do every read + print the plan, then ROLL BACK; uploads nothing
//
// Money (READ THIS BEFORE CHANGING THE PRICE)
//   The payment engine (src/lib/visa/payments.ts) charges ONE flat fee for every
//   application — visaPaymentsConfig() reads a single VISA_SERVICE_FEE_USD and both
//   Stripe and PayPal orders are minted in USD. There is no per-product amount
//   anywhere in the checkout path (the checkout route always passes config.feeCents).
//   So every product here carries the SAME price, stored in USD ('$'), and that price
//   is the fee the buyer is actually charged. Advertising a different amount than
//   checkout takes would be a consumer-protection problem, so:
//     · this script refuses to invent a price — pass --price-usd or set VISA_SERVICE_FEE_USD;
//     · it REFUSES to run when the two disagree;
//     · it refuses a fractional amount, because the marketplace money formatter rounds
//       to whole units (formatMoneyFull → Math.round), so $25.50 would advertise "$26".
//   Per-product pricing needs a payments change first.
//
// What this script deliberately does NOT do
//   · no schema DDL (the orchestrator owns that);
//   · no Telegram/Facebook syndication, no Meta CAPI, no Vertex AI-search index and no
//     translation warm — those are after() side-effects of the app's create path, which
//     a direct SQL seed bypasses. Run scripts/prewarm-translations.mjs and the Vertex
//     backfill if these products should also be found by the AI concierge;
//   · no trust/badge fabrication: the storefront starts unverified with 0 reviews,
//     exactly like a real new seller (src/app/api/listings/resolve-seller.ts).

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'
// Node ≥22 strips the types, so these import straight from the app's own sources — the
// rankScore formula and the searchText recipe are NEVER re-implemented here (three
// hand-mirrored copies of the ranking SQL had already drifted once; see the header of
// src/lib/ranking-formula.ts).
import { rankScoreExprSql } from '../src/lib/ranking-formula.ts'
import { buildSearchText } from '../src/lib/fold.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// ── args ───────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const has = (name) => argv.includes(`--${name}`)
const opt = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

function fail(message) {
  console.error(`\n✗ ${message}\n`)
  process.exit(1)
}
const warnings = []
function warn(message) {
  warnings.push(message)
  console.warn(`  ⚠ ${message}`)
}

if (has('help')) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).join('\n'))
  process.exit(0)
}
const DRY_RUN = has('dry-run')
const ALLOW_NO_IMAGE = has('allow-no-image')
const FORCE = has('force')
const STATUS_ARG = opt('status')
const STATUS = STATUS_ARG || 'active'
if (!['active', 'hidden'].includes(STATUS)) fail(`--status must be active or hidden (got "${STATUS}")`)

// ── env ────────────────────────────────────────────────────────────────────────────
const PG_URL = process.env.DIRECT_URL || process.env.DATABASE_URL
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY
if (!PG_URL) fail('Set DIRECT_URL (or DATABASE_URL) — run with `node --env-file=.env`.')
if (!SUPABASE_URL || !SUPABASE_SECRET) fail('Set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY (the shop owner is resolved from Supabase auth).')

// Owner identity is LOCKED to support@eno.vn; the env override exists for staging
// projects only. Keep it byte-equal with VISA_SHOP_OWNER_EMAIL in src/lib/visa-shop.ts
// (and with apps/forum/src/lib/visa/auth.ts:5 while that app still exists).
const OWNER_EMAIL = (process.env.VISA_SHOP_OWNER_EMAIL || 'support@eno.vn').trim().toLowerCase()
const SHOP_NAME = process.env.VISA_SHOP_NAME || 'eno Visa Services'
const SHOP_CITY = process.env.VISA_SHOP_CITY || 'Ho Chi Minh City'
const SHOP_LOCATION = process.env.VISA_SHOP_LOCATION || 'Online — nationwide'
const SHOP_HANDLE = (process.env.VISA_SHOP_HANDLE || 'enovisa').toLowerCase()
const SHOP_BIO = 'Official eno e-visa desk. We prepare, check and submit Vietnam e-visa applications for travellers, and answer questions in the same chat thread.'
const SELLER_ID = 'eno-visa-shop' // stable id, so re-runs and fixtures can address the row

const feeEnv = process.env.VISA_SERVICE_FEE_USD
const priceArg = opt('price-usd')
const PRICE_USD = Number.parseFloat(priceArg ?? feeEnv ?? '')
if (!Number.isFinite(PRICE_USD) || PRICE_USD <= 0) {
  fail(
    'No price. Pass --price-usd=<amount> or set VISA_SERVICE_FEE_USD.\n' +
    '  The listing price must equal what checkout charges, and that amount is the owner\'s\n' +
    '  business decision — this script will not invent one.',
  )
}
// A fractional fee would be CHARGED in full but DISPLAYED rounded (formatMoneyFull does
// Math.round), i.e. "$26" on a $25.50 charge. Refuse rather than advertise a wrong number.
if (!Number.isInteger(PRICE_USD)) {
  fail(`--price-usd must be a whole number of dollars (got ${PRICE_USD}). The marketplace price formatter rounds, so a fractional fee would be advertised as $${Math.round(PRICE_USD)}.`)
}
// The listing must never advertise an amount other than the one checkout takes.
if (priceArg && feeEnv && Number.parseFloat(feeEnv) !== PRICE_USD) {
  fail(`--price-usd=${PRICE_USD} disagrees with VISA_SERVICE_FEE_USD=${feeEnv}. Checkout charges the ENV amount, so the shop would advertise a price it does not take. Set them equal (or drop --price-usd).`)
}

// ── product catalogue ──────────────────────────────────────────────────────────────
// ⚠️ The KEYS below are the contract with src/lib/visa-shop.ts (VISA_PRODUCTS) — the app
// resolves a listing back to a product through them. They are checked against that file
// at startup (assertCatalogueInSync), so drift fails loudly instead of quietly producing
// listings the app cannot recognise.
//
// Why only two products: src/lib/visa/schema.ts IS the engine, and the only axis it
// models is entryType (single | multiple). Its one WINDOW is MAX_EVISA_VALIDITY_DAYS =
// 90 — visaDateDefaultsForStart() produces nothing else and validateVisaForReview()
// rejects anything longer (visa_period_exceeds_90_days). A shorter stay is *validatable*
// (stayLengthDays accepts 1–90 with explicit dates), so a 30-day SKU is not impossible —
// it just has no date-default rule and no price the flat-fee checkout could charge
// differently. Inventing one here would be inventing product, not deriving it.
const EXTERNAL_PREFIX = 'visa:'
const SHARED_INTRO =
  'Apply for your Vietnam e-visa without leaving the chat. Start a message thread here, upload your passport photo page and a portrait, and our assistant reads the details for you — you confirm what it found and answer only the few questions a passport cannot answer.'
const SHARED_REQUIREMENTS =
  'Before you start: a passport valid for at least six months, one clear portrait photo, a photo page with no glare, and a planned arrival date. You must be outside Vietnam when the application is made.'
const SHARED_FEE =
  'The price shown is the eno assistance service fee, paid securely inside the chat. Ask anything in the thread — a person can take over from the assistant at any time.'

const PRODUCTS = [
  {
    key: 'evisa-90-single',
    title: 'Vietnam e-visa assistance — 90-day single entry',
    titleVi: 'Hỗ trợ xin e-visa Việt Nam — 90 ngày, nhập cảnh một lần',
    description: [
      SHARED_INTRO,
      'What you get: a 90-day single-entry e-visa application, prepared and checked by our team before it is submitted, with every update posted back into the same thread.',
      SHARED_REQUIREMENTS,
      SHARED_FEE,
    ].join('\n\n'),
  },
  {
    key: 'evisa-90-multiple',
    title: 'Vietnam e-visa assistance — 90-day multiple entry',
    titleVi: 'Hỗ trợ xin e-visa Việt Nam — 90 ngày, nhập cảnh nhiều lần',
    description: [
      SHARED_INTRO,
      'What you get: a 90-day multiple-entry e-visa application, so you can leave and re-enter Vietnam as often as you need while it is valid. Prepared and checked by our team before it is submitted, with every update posted back into the same thread.',
      SHARED_REQUIREMENTS,
      SHARED_FEE,
    ].join('\n\n'),
  },
].map((product) => ({ ...product, externalId: `${EXTERNAL_PREFIX}${product.key}` }))

// Taxonomy placement (src/lib/taxonomy.ts → category 11 "Services").
const CATEGORY_SLUG = 'services'
const SUBCATEGORY_SLUG = 'visa-legal'
const LISTING_TYPE = 'service' // one of the Services category's declared types
// Whitelisted facet values from that same taxonomy entry, so the products filter like
// any other service listing.
const ATTRIBUTES = JSON.stringify({ serviceLocation: 'online', providerType: 'business' })

/** The app's product contract must know every key we seed, and vice versa. */
function assertCatalogueInSync() {
  const file = path.join(ROOT, 'src/lib/visa-shop.ts')
  if (!existsSync(file)) fail('src/lib/visa-shop.ts is missing — the seed and the app must agree on the product keys.')
  const source = readFileSync(file, 'utf8')
  const appKeys = new Set([...source.matchAll(/key:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]))
  const seedKeys = new Set(PRODUCTS.map((p) => p.key))
  const missingInApp = [...seedKeys].filter((k) => !appKeys.has(k))
  const missingInSeed = [...appKeys].filter((k) => !seedKeys.has(k))
  if (missingInApp.length || missingInSeed.length) {
    fail(
      'Product catalogue drift between this script and src/lib/visa-shop.ts:\n' +
      (missingInApp.length ? `  seeded but unknown to the app: ${missingInApp.join(', ')}\n` : '') +
      (missingInSeed.length ? `  declared by the app but not seeded: ${missingInSeed.join(', ')}` : ''),
    )
  }
  if (!source.includes(`VISA_PRODUCT_EXTERNAL_PREFIX = '${EXTERNAL_PREFIX}'`)) {
    fail(`src/lib/visa-shop.ts no longer declares VISA_PRODUCT_EXTERNAL_PREFIX = '${EXTERNAL_PREFIX}'.`)
  }
}

/**
 * Run the REAL publish gate over the seeded copy — banned words, off-platform contact
 * info, phone numbers, photo count. Only possible under a TypeScript loader
 * (`npx tsx scripts/seed-visa-shop.mjs`), because publish-guard.ts imports its
 * neighbours without file extensions and plain Node ESM cannot resolve those. Skipped
 * — never faked — otherwise: re-implementing the gate here is exactly the kind of
 * drift this repo keeps getting bitten by.
 */
async function publishGateSelfCheck(imagesByKey) {
  let guard
  try {
    guard = await import('../src/lib/publish-guard.ts')
  } catch {
    console.log('  (publish-gate self-check skipped — re-run under `npx tsx` to enable it)')
    return
  }
  guard.assertCleanContactName(SHOP_NAME)
  guard.assertCleanTexts([SHOP_BIO, SHOP_CITY, SHOP_LOCATION])
  for (const product of PRODUCTS) {
    const urls = imagesByKey.get(product.key) || []
    // titleVi rides along in `texts` (the create path only screens the EN title, because
    // there the Vietnamese title does not exist yet) — a seeded row publishes both.
    const texts = [product.title, product.titleVi, product.description]
    if (urls.length || !ALLOW_NO_IMAGE) {
      guard.assertPublishable({ trustTier: 'standard', images: urls, texts, categorySlug: CATEGORY_SLUG })
    } else {
      // --allow-no-image deliberately waives the PHOTO rule (and only that rule); the
      // content screens still have to pass.
      guard.assertCleanTexts(texts)
    }
  }
  console.log('  publish gate: clean')
}

// ── artwork ────────────────────────────────────────────────────────────────────────
// A service listing needs ONE photo (publish-guard.minPhotosFor('services') === 1 — the
// 3-different-angles rule is for physical goods). Resolution order per product:
//   1. --image=<url>  (⚠️ must be a first-party `listings`-bucket URL: the dashboard EDIT
//      path filters images through isListingImageUrl, so a foreign URL is silently
//      dropped there and the edit then fails photo_required)
//   2. public/listings/visa-<key>.(png|jpg|jpeg|webp) → uploaded to the public
//      `listings` bucket at a STABLE path, so re-runs reuse the same URL
//   3. whatever the existing listing already has (a re-run never blanks a photo)
//   4. nothing → REFUSED by default. A live, paid, first-party listing with no photo
//      contradicts the platform's own publish gate, so seeding one takes an explicit
//      --allow-no-image (dev/staging). The card would render its category-icon tile and
//      the listing could not be edited in the dashboard until a photo was added.
const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }
const IMAGE_OVERRIDE = opt('image')
const LISTINGS_BUCKET = 'listings'
const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET, { auth: { persistSession: false, autoRefreshToken: false } })
const canonicalImagePrefix = `${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/${LISTINGS_BUCKET}/`

async function resolveImages(product, existing) {
  if (IMAGE_OVERRIDE) return [IMAGE_OVERRIDE]
  for (const ext of Object.keys(IMAGE_TYPES)) {
    const file = path.join(ROOT, 'public/listings', `visa-${product.key}.${ext}`)
    if (!existsSync(file)) continue
    const objectPath = `visa-shop/${product.key}.${ext}`
    if (DRY_RUN) return [`${canonicalImagePrefix}${objectPath}`]
    // upsert + a SHORT cache: unlike app uploads (immutable, hash-named, cached for a
    // year) this object path is stable, so replacing the artwork must be visible.
    // (An upload that lands and is then followed by a failed/rolled-back transaction
    // leaves the object behind. Harmless: the path is deterministic, so the next run
    // reuses that exact object rather than orphaning another one.)
    const { error } = await supabase.storage.from(LISTINGS_BUCKET).upload(objectPath, readFileSync(file), {
      contentType: IMAGE_TYPES[ext], upsert: true, cacheControl: '3600',
    })
    if (error) {
      warn(`artwork upload failed for ${product.key}: ${error.message}`)
      break
    }
    return [supabase.storage.from(LISTINGS_BUCKET).getPublicUrl(objectPath).data.publicUrl]
  }
  return existing.length ? existing : []
}

// The owner account must already exist in Supabase auth: Profile.id is FK-bound to
// auth.users (scripts/profile-auth-fk.mjs), so there is no id to invent.
async function findAuthUser(email) {
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw new Error(`listUsers failed: ${error.message}`)
    const hit = data.users.find((u) => (u.email || '').toLowerCase() === email)
    if (hit) return hit
    if (data.users.length < 200) return null
  }
  return null
}

// ── main ───────────────────────────────────────────────────────────────────────────
assertCatalogueInSync()

console.log(`\neno visa shop — ${DRY_RUN ? 'DRY RUN' : 'seeding'}`)
console.log(`  owner    ${OWNER_EMAIL}`)
console.log(`  price    $${PRICE_USD.toFixed(2)} per product (flat — checkout charges one fee)`)
console.log(`  status   ${STATUS}\n`)

if (!feeEnv) {
  // (A --price-usd that DISAGREES with a set fee is fatal, above. This is the other
  // half: no fee env at all.)
  warn('VISA_SERVICE_FEE_USD is not set, so visaPaymentsConfig() is null and checkout stays DORMANT: the shop would advertise a price it cannot yet charge. Set the fee before the products go public.')
}
if (STATUS === 'hidden') {
  warn('status=hidden keeps the products out of the public feed and 404s their detail pages. They stay messageable (/api/conversations only checks `verified`), but any surface listing them must not filter on status=active.')
}

const authUser = await findAuthUser(OWNER_EMAIL)
if (!authUser) {
  fail(`No Supabase auth user for ${OWNER_EMAIL}. Create/confirm that account first — the storefront must be owned by the real support account (its Profile id is the seller side of every visa thread).`)
}

const db = new pg.Client({ connectionString: PG_URL })
await db.connect()

let exitCode = 0
try {
  // Artwork first: uploads are network calls, and they have no business inside an open
  // transaction. Existing images are read before the tx purely to preserve them.
  const preSeller = (await db.query(`SELECT id FROM "Seller" WHERE "ownerId" = $1`, [authUser.id])).rows[0]
  const imagesByKey = new Map()
  for (const product of PRODUCTS) {
    let existingImages = []
    if (preSeller) {
      // Same two-key lookup the upsert uses (marker first, deterministic id second), so
      // a row that lost its marker still contributes its existing photo instead of
      // reading as "no artwork".
      const row = (await db.query(
        `SELECT images FROM "Listing"
         WHERE ("sellerId" = $1 AND "externalId" = $2) OR ("sellerId" = $1 AND id = $3)
         ORDER BY ("externalId" = $2) DESC LIMIT 1`,
        [preSeller.id, product.externalId, `visa-${product.key}`],
      )).rows[0]
      try {
        const parsed = JSON.parse(row?.images || '[]')
        if (Array.isArray(parsed)) existingImages = parsed.filter((u) => typeof u === 'string')
      } catch { existingImages = [] }
    }
    const urls = await resolveImages(product, existingImages)
    imagesByKey.set(product.key, urls)
    if (!urls.length) {
      const message = `no artwork for ${product.key} — drop a photo at public/listings/visa-${product.key}.png, or pass --image=<url>. Pass --allow-no-image to seed it anyway (the card renders its category-icon tile, and the listing cannot be edited in the dashboard until it has a photo: assertEnoughAngles → photo_required).`
      if (!ALLOW_NO_IMAGE) throw new Error(message)
      warn(message)
    } else if (!urls[0].startsWith(canonicalImagePrefix)) {
      warn(`${product.key}: image is not a ${LISTINGS_BUCKET}-bucket URL. next/image only optimizes hosts listed in next.config remotePatterns, AND the dashboard edit path drops non-first-party URLs (isListingImageUrl) — after which the edit fails photo_required.`)
    }
  }

  await publishGateSelfCheck(imagesByKey)

  await db.query('BEGIN')

  // ── Profile (never clobbers an existing account) ────────────────────────────────
  const created = await db.query(
    `INSERT INTO "Profile" (id, email, "displayName", "accountType", "businessName", "updatedAt")
     VALUES ($1, $2, $3, 'business', $3, now())
     ON CONFLICT DO NOTHING`,
    [authUser.id, OWNER_EMAIL, SHOP_NAME],
  )
  const profile = (await db.query(`SELECT id, email FROM "Profile" WHERE id = $1`, [authUser.id])).rows[0]
  if (!profile) {
    throw new Error(`Profile ${authUser.id} could not be created — another Profile row probably already holds ${OWNER_EMAIL} (Profile.email is unique).`)
  }
  // src/lib/visa-shop.ts resolves the storefront BY OWNER EMAIL, so a pre-existing
  // Profile with a null/stale email (e.g. a phone-only signup) would leave the app
  // unable to find a shop this script just seeded. Reconcile it — the same field
  // ensureProfile() mirrors from auth on every sign-in.
  if ((profile.email || '').toLowerCase() !== OWNER_EMAIL) {
    const other = (await db.query(`SELECT id FROM "Profile" WHERE lower(email) = $1 AND id <> $2`, [OWNER_EMAIL, authUser.id])).rows[0]
    if (other) throw new Error(`Profile ${other.id} already holds ${OWNER_EMAIL}, but the storefront owner is ${authUser.id}. Fix that by hand — the shop is resolved by owner email.`)
    await db.query(`UPDATE "Profile" SET email = $2, "updatedAt" = now() WHERE id = $1`, [authUser.id, OWNER_EMAIL])
    console.log(`  set      Profile.email → ${OWNER_EMAIL}`)
  }
  if (created.rowCount) {
    console.log(`  CREATED  Profile ${authUser.id}`)
    warn('this run PROVISIONED the support Profile. A profile created by signing in instead goes through ensureProfile() → recordNewAccount(), which sets the real trust baseline; this row starts at the column default. Sign in as the support account once before seeding if you want that baseline.')
  } else {
    console.log(`  reused   Profile ${authUser.id}`)
  }

  // ── Seller (the storefront) ─────────────────────────────────────────────────────
  let seller = (await db.query(
    `SELECT id, name, "trustScore" FROM "Seller" WHERE "ownerId" = $1`,
    [authUser.id],
  )).rows[0]

  if (!seller) {
    const clash = (await db.query(`SELECT "ownerId" FROM "Seller" WHERE id = $1`, [SELLER_ID])).rows[0]
    if (clash) throw new Error(`Seller id "${SELLER_ID}" already belongs to profile ${clash.ownerId} — refusing to take it over.`)
    // Same posture as a real new storefront (resolve-seller.ts): no verified badge, no
    // rating, no review count. Trust is earned from evidence, never seeded.
    seller = (await db.query(
      `INSERT INTO "Seller" (id, name, "ownerId", "avatarColor", location, bio, rating, "reviewCount", verified, "verifiedSeller", "responseRate")
       VALUES ($1, $2, $3, '#0a66c2', $4, $5, 0, 0, false, false, 100)
       RETURNING id, name, "trustScore"`,
      [SELLER_ID, SHOP_NAME, authUser.id, SHOP_CITY, SHOP_BIO],
    )).rows[0]
    console.log(`  CREATED  Seller ${seller.id} "${seller.name}"`)
  } else {
    // Re-run: fill only what is EMPTY. The owner may have renamed or rewritten the
    // storefront in the dashboard, and a seed must not undo that.
    await db.query(
      `UPDATE "Seller" SET location = COALESCE(location, $2), bio = COALESCE(bio, $3) WHERE id = $1`,
      [seller.id, SHOP_CITY, SHOP_BIO],
    )
    console.log(`  reused   Seller ${seller.id} "${seller.name}"`)
  }

  // ── Public @handle (best effort — a taken name is not a failure) ────────────────
  const handleRow = (await db.query(`SELECT handle FROM "Handle" WHERE "sellerId" = $1`, [seller.id])).rows[0]
  if (handleRow) {
    console.log(`  reused   handle @${handleRow.handle}`)
  } else if (/^[a-z][a-z0-9_]{2,29}$/.test(SHOP_HANDLE)) {
    const res = await db.query(
      `INSERT INTO "Handle" (handle, "sellerId") VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING handle`,
      [SHOP_HANDLE, seller.id],
    )
    if (res.rowCount) console.log(`  CREATED  handle @${SHOP_HANDLE}`)
    else warn(`handle @${SHOP_HANDLE} is taken — the storefront has no public @name (set VISA_SHOP_HANDLE to another one).`)
  } else {
    warn(`VISA_SHOP_HANDLE="${SHOP_HANDLE}" is not a valid handle (^[a-z][a-z0-9_]{2,29}$) — skipped.`)
  }

  // ── Category ───────────────────────────────────────────────────────────────────
  const category = (await db.query(
    `SELECT id, name, "nameVi" FROM "Category" WHERE slug = $1`,
    [CATEGORY_SLUG],
  )).rows[0]
  if (!category) throw new Error(`No "${CATEGORY_SLUG}" category row — run \`npx tsx scripts/sync-categories.ts\` first.`)

  // ── Listings (one per product) ─────────────────────────────────────────────────
  const seededIds = []
  const summary = []

  for (const product of PRODUCTS) {
    const listingId = `visa-${product.key}`
    const COLUMNS = `id, "sellerId", title, "titleVi", description, price, location, city, images, status`
    // Primary lookup: the product KEY. Fallback: the deterministic row id — otherwise a
    // row whose externalId was cleared (dashboard/API edit, partial restore) is invisible
    // here and the INSERT below dies on a primary-key collision instead of adopting it.
    let existing = (await db.query(
      `SELECT ${COLUMNS} FROM "Listing" WHERE "sellerId" = $1 AND "externalId" = $2`,
      [seller.id, product.externalId],
    )).rows[0]
    if (!existing) {
      const byId = (await db.query(`SELECT ${COLUMNS} FROM "Listing" WHERE id = $1`, [listingId])).rows[0]
      if (byId && byId.sellerId !== seller.id) {
        throw new Error(`Listing id "${listingId}" already belongs to seller ${byId.sellerId} — refusing to touch another shop's row.`)
      }
      if (byId) {
        existing = byId
        console.log(`  adopted  ${listingId} (its ${product.externalId} marker was missing)`)
      }
    }

    // EDITABLE fields: what the shop may legitimately have rewritten in the dashboard.
    // A seed must not silently undo the owner's work, so on a re-run these are kept
    // whenever they differ — unless --force (or the value is empty, or --status was
    // passed explicitly). Everything else below is a structural invariant of a visa
    // product and is always reconciled.
    const editable = {
      title: product.title,
      titleVi: product.titleVi,
      description: product.description,
      price: PRICE_USD,
      location: SHOP_LOCATION,
      city: SHOP_CITY,
      images: JSON.stringify(imagesByKey.get(product.key) || []),
      status: STATUS,
    }
    const final = { ...editable }
    const kept = []
    if (existing) {
      for (const [column, desired] of Object.entries(editable)) {
        const current = existing[column]
        const isEmpty = current === null || current === undefined || current === '' || (column === 'images' && current === '[]')
        const forced = FORCE || (column === 'status' && !!STATUS_ARG)
        if (forced || isEmpty) continue
        const same = column === 'price' ? Number(current) === Number(desired) : String(current) === String(desired)
        if (same) continue
        final[column] = current
        kept.push(column)
      }
      if (kept.length) {
        console.log(`  kept     ${product.key}: ${kept.join(', ')} as edited in the dashboard (use --force to overwrite)`)
      }
      if (Number(final.price) !== PRICE_USD) {
        warn(`${product.key} advertises $${Number(final.price)} but checkout charges $${PRICE_USD.toFixed(2)} — re-run with --force, or change the fee.`)
      }
    }

    // The searchText recipe is byte-identical to createListingCore's, and is built from
    // the copy that will actually be stored (kept edits included).
    const searchText = buildSearchText([final.title, final.description, null, category.name, category.nameVi, null, null])

    // [column, value] pairs → SQL, so the placeholders can never drift from the values.
    const fields = [
      ['title', final.title],
      ['titleVi', final.titleVi],
      ['description', final.description],
      ['price', final.price],
      // Empty unit: <Price> renders "$25" and appends " / <unit>" for anything else.
      ['priceUnit', ''],
      ['currency', '$'],
      ['location', final.location],
      ['city', final.city],
      ['images', final.images],
      ['categoryId', category.id],
      ['subcategorySlug', SUBCATEGORY_SLUG],
      ['listingType', LISTING_TYPE],
      ['attributes', ATTRIBUTES],
      ['searchText', searchText],
      ['sellerTrustScore', seller.trustScore],
      ['status', final.status],
      // Re-stamped on every run: the marker IS the app's product contract, so a row that
      // lost it (adopted above) gets it back.
      ['externalId', product.externalId],
    ]

    if (existing) {
      const setSql = fields.map(([column], i) => `"${column}" = $${i + 1}`).join(', ')
      await db.query(
        `UPDATE "Listing" SET ${setSql}, negotiable = false, verified = true, "updatedAt" = now()
         WHERE id = $${fields.length + 1}`,
        [...fields.map(([, value]) => value), existing.id],
      )
      seededIds.push(existing.id)
      summary.push({ key: product.key, id: existing.id, action: 'updated', price: final.price, images: final.images })
    } else {
      const insertFields = [...fields, ['id', listingId], ['sellerId', seller.id]]
      const columnSql = insertFields.map(([column]) => `"${column}"`).join(', ')
      const valueSql = insertFields.map((_, i) => `$${i + 1}`).join(', ')
      await db.query(
        // negotiable=false: a fixed service fee. An offer on a fixed-price listing is
        // rejected server-side (409) and docks the buyer's trust, so the offer UI must
        // stay hidden here.
        `INSERT INTO "Listing" (${columnSql}, negotiable, verified, "rankScore", "postedAt", "createdAt", "updatedAt")
         VALUES (${valueSql}, false, true, 0, now(), now(), now())`,
        insertFields.map(([, value]) => value),
      )
      seededIds.push(listingId)
      summary.push({ key: product.key, id: listingId, action: 'created', price: final.price, images: final.images })
    }
  }

  // rankScore from the ONE shared formula (imported above, never re-typed).
  await db.query(`UPDATE "Listing" SET "rankScore" = ${rankScoreExprSql()} WHERE id = ANY($1)`, [seededIds])

  if (DRY_RUN) {
    await db.query('ROLLBACK')
    console.log('\n  DRY RUN — rolled back, nothing written.')
  } else {
    await db.query('COMMIT')
  }

  console.log('')
  for (const row of summary) {
    let count = 0
    try { count = JSON.parse(row.images || '[]').length } catch { count = 0 }
    console.log(`  ${row.action.toUpperCase().padEnd(8)} ${row.id.padEnd(24)} $${Number(row.price).toFixed(2)}  ${count} photo(s)`)
  }
  console.log(`\n  ${summary.length} product listing(s) · seller ${seller.id} · owner ${OWNER_EMAIL}`)
  if (warnings.length) console.log(`  ${warnings.length} warning(s) above.`)
  console.log('')
} catch (e) {
  await db.query('ROLLBACK').catch(() => {})
  console.error(`\n✗ ${e instanceof Error ? e.message : e}\n`)
  exitCode = 1
} finally {
  await db.end()
}

// Let the process end on its own so stdout finishes flushing (process.exit() can
// truncate a piped log), with an unref'd backstop in case some handle lingers.
process.exitCode = exitCode
setTimeout(() => process.exit(exitCode), 5000).unref()
