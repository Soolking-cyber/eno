// ── Seed the eno e-VISA SHOP (idempotent) ──────────────────────────────────────────
//
// THE CATALOGUE IS THE MARKETPLACE. A visa service is sold as an ORDINARY listing on the
// visa storefront: one listing per (entry type × processing speed), each with ITS OWN
// price on Listing.price, exactly like any other seller sets a price. This script creates
// that storefront — a Seller owned by support@eno.vn plus one listing per product — and
// nothing else. Re-running it never duplicates a row: every product is keyed on
// `Listing.externalId` (unique per seller), so a second run UPDATES the same rows.
//
//   node --env-file=.env scripts/seed-visa-shop.mjs --vnd-per-usd=26100
//   npx tsx scripts/seed-visa-shop.mjs --vnd-per-usd=26100 --dry-run   # + publish-gate self-check
//
// Flags
//   --vnd-per-usd=<n> REQUIRED. Đồng per ONE dollar (≈ 26000), used to convert the USD
//                     reference grid below into the ĐỒNG that is actually stored. There is
//                     no default and there must never be one — see "Money".
//   --vnd-round=<n>   round each converted price to this many đồng (default 1000)
//   --image=<url>     artwork for every product (skips the local-file upload)
//   --allow-no-image  seed a product with no photo (dev/staging only — see "Artwork")
//   --force           overwrite listing copy/price/attributes/status that was edited in the dashboard
//   --status=hidden   seed the listings out of the public feed (default: active)
//   --dry-run         do every read + print the plan, then ROLL BACK; uploads nothing
//   --catalogue       print the products this script WOULD seed and exit. No env, no
//                     network, no database, no writes — the one way to review the grid
//                     (and the copy derived from src/lib/visa/speed.ts) without pointing
//                     the seeder at a real project. Still needs --vnd-per-usd, because the
//                     đồng figures it prints are the ones a real run would write. Under
//                     `npx tsx` it also screens that copy through the real publish gate.
//
// Money (READ THIS BEFORE CHANGING A PRICE)
//   ⚠️ A VISA PRODUCT IS PRICED IN ĐỒNG (owner, 2026-07-22): "admin posts in vnd and you
//   show in vnd and usd to users they checkout accordingly usd from their paypal but the
//   vnd equivalent that admin set." Listing.price is therefore ĐỒNG, exactly like every
//   other listing on the marketplace, and the dollars a foreign buyer sees and pays are a
//   SERVER-ISSUED QUOTE of that đồng figure, minted per checkout by src/lib/visa/fx.ts.
//   Nothing in this script stores, or may store, a dollar amount.
//
//   The grid below is the OWNER'S REFERENCE GRID and it is written in dollars, because
//   that is how the provider publishes it. So it has to be converted, and the rate for
//   that conversion is a fact about the world on the day of the run:
//     · --vnd-per-usd is REQUIRED and this script REFUSES TO RUN without it. A default
//       would not fail — it would seed a catalogue quietly 15% wrong and leave it wrong
//       until somebody noticed. The operator reads today's number off the same feed the
//       app uses (open.er-api.com/v6/latest/VND, where `rates.USD` is dollars per đồng, so
//       the number wanted here is 1 / rates.USD) and types it in;
//     · the rate is band-checked (5 000–100 000) exactly like src/lib/visa/fx.ts, so an
//       inverted rate, a rate in thousands, or a typo is refused instead of seeded;
//     · converted prices are rounded to whole thousands of đồng (--vnd-round), the way
//       every price on this marketplace is written.
//   Once a row exists, the price is read off Listing.price at checkout time
//   (resolveVisaProduct → src/lib/visa-shop.ts), so what the card advertises and what the
//   card captures are the same number by construction — there is no second copy of the
//   amount anywhere for the two to drift apart.
//   Consequences that still bind:
//     · prices are WHOLE ĐỒNG. đồng has no minor unit, and src/lib/visa-shop.ts refuses to
//       sell a fractional price (sellablePriceVnd) because the marketplace formatter rounds
//       — a 3.000.000,5 ₫ listing would advertise 3.000.001 ₫. This script asserts the same
//       on its own grid and WARNS when a price it preserved from the dashboard would be
//       unsellable;
//     · `currency` is force-stamped '₫' on every seeded row, because sellablePriceVnd
//       accepts ₫/Đ/VND only. ⚠️ A row this script finds still carrying '$' from the
//       reverted USD-storage rule (f7f8ca40) has a DOLLAR number in its price column: it is
//       CONVERTED at --vnd-per-usd rather than re-labelled, because re-labelling $115 as
//       115 ₫ would put a US$0.004 visa on sale;
//     · VISA_SERVICE_FEE_USD is NOT a price any more — it is the dormant/live switch for
//       payments (src/lib/visa/payments.ts). Nothing here derives an amount from it.
//
// Admin edits win (the whole point of the re-run rules)
//   The admin owns this storefront in the dashboard. On a re-run every EDITABLE field —
//   copy, price, ATTRIBUTES (the visaEntryType/visaSpeed chips), photos, location, status —
//   is preserved whenever it differs from the seed, and only `--force` overwrites it.
//   Structural invariants (category, subcategory, listing type, currency, the externalId
//   marker, verified/negotiable) are always reconciled.
//
// What changed when pricing became per-product (do not restore these)
//   · `--price-usd` — REMOVED. There is no single price to pass; the grid below is
//     per (entry type × speed), and after the first run the dashboard is authoritative.
//   · the VISA_SERVICE_FEE_USD cross-check — REMOVED. It existed because checkout charged
//     an env fee while the listing advertised its own number, so the two had to be forced
//     equal. Checkout now charges Listing.price, so the class of bug is gone.
//   · assertCatalogueInSync() — REMOVED. It grepped src/lib/visa-shop.ts for hard-coded
//     SKU keys; that file no longer holds a catalogue (the listings are the catalogue), so
//     the grep asserted against a legacy comment block. What replaces it is stronger and
//     structural: the product grid is BUILT from src/lib/visa/speed.ts (VISA_ENTRY_TYPES ×
//     VISA_SPEED_CODES), asserted complete in both directions at startup, and the taxonomy
//     facet options are cross-checked against those same codes.
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
// rankScore formula, the searchText recipe and the SPEED TIERS are NEVER re-implemented
// here (three hand-mirrored copies of the ranking SQL had already drifted once; see the
// header of src/lib/ranking-formula.ts, and the label drift already visible between
// src/lib/taxonomy.ts and src/lib/visa/speed.ts).
import { rankScoreExprSql } from '../src/lib/ranking-formula.ts'
import { buildSearchText } from '../src/lib/fold.ts'
import { VISA_ENTRY_TYPES, VISA_SPEED_CODES, VISA_SPEED_SPECS } from '../src/lib/visa/speed.ts'

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

// A retired flag must not be silently IGNORED: `--price-usd=25` used to set the price of
// every product, and an operator repeating it from muscle memory would otherwise get a
// completely different (grid-priced) catalogue with no hint that their number was dropped.
const KNOWN_FLAGS = new Set(['help', 'catalogue', 'dry-run', 'allow-no-image', 'force', 'status', 'image', 'vnd-per-usd', 'vnd-round'])
const RETIRED_FLAGS = {
  'price-usd': 'Prices are PER PRODUCT now: the grid in this script seeds them, and after that Listing.price (edited in the dashboard) is what checkout charges. There is no single price to pass.',
}
for (const arg of argv) {
  const name = /^--([^=]+)/.exec(arg)?.[1]
  if (!name) fail(`Unexpected argument "${arg}" — this script takes flags only.`)
  if (RETIRED_FLAGS[name]) fail(`--${name} was removed. ${RETIRED_FLAGS[name]}`)
  if (!KNOWN_FLAGS.has(name)) fail(`Unknown flag --${name}. Known flags: ${[...KNOWN_FLAGS].map((f) => `--${f}`).join(', ')}.`)
}

const DRY_RUN = has('dry-run')
const ALLOW_NO_IMAGE = has('allow-no-image')
const FORCE = has('force')
const STATUS_ARG = opt('status')
const STATUS = STATUS_ARG || 'active'
if (!['active', 'hidden'].includes(STATUS)) fail(`--status must be active or hidden (got "${STATUS}")`)

// ── the đồng/dollar rate: passed, never invented ───────────────────────────────────
//
// See "Money" in the header. The band is byte-equal to MIN/MAX_VND_PER_USD in
// src/lib/visa/fx.ts and exists for the same reason: a VND/USD rate has been in the TENS
// OF THOUSANDS since the 1990s, so 0.0000383 (the inverted rate, which is what the upstream
// feed publishes), 26.1 (the rate in thousands) and 1 (a base mix-up) are all refused. Each
// of those reads as an ordinary number in a log and each is a 1 000×-or-worse pricing bug.
const MIN_VND_PER_USD = 5_000
const MAX_VND_PER_USD = 100_000
const VND_PER_USD_ARG = opt('vnd-per-usd')
if (VND_PER_USD_ARG === undefined) {
  fail(
    'Pass --vnd-per-usd=<rate> — đồng per ONE dollar, used to convert this script\'s USD reference grid.\n' +
    '  A visa service is priced in ĐỒNG on the listing (owner, 2026-07-22) and this script will not invent an exchange rate:\n' +
    '  a wrong default does not fail, it seeds a catalogue that is quietly wrong and stays wrong.\n' +
    '  Today\'s number is 1 / rates.USD from the feed the app itself uses:\n' +
    '    curl -s https://open.er-api.com/v6/latest/VND | node -e \'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(Math.round(1/JSON.parse(s).rates.USD)))\'\n' +
    '  Then: node --env-file=.env scripts/seed-visa-shop.mjs --vnd-per-usd=<that number>',
  )
}
const VND_PER_USD = Number(VND_PER_USD_ARG)
if (!Number.isFinite(VND_PER_USD) || VND_PER_USD <= 0) fail(`--vnd-per-usd="${VND_PER_USD_ARG}" is not a positive number.`)
if (VND_PER_USD < MIN_VND_PER_USD || VND_PER_USD > MAX_VND_PER_USD) {
  fail(`--vnd-per-usd=${VND_PER_USD} is outside the plausible band (${MIN_VND_PER_USD}–${MAX_VND_PER_USD} đồng per dollar). A VND/USD rate is in the tens of thousands — that number looks like an inverted rate, a rate quoted in thousands, or a typo.`)
}

// Đồng prices on this marketplace are written in whole thousands (3.002.000 ₫), never to
// the đồng, so a converted price is rounded to that grid. The step is a flag because it is
// a presentation decision, not a money rule: --vnd-round=1 stores the exact conversion.
const VND_ROUND_ARG = opt('vnd-round')
const VND_ROUND_STEP = VND_ROUND_ARG === undefined ? 1_000 : Number(VND_ROUND_ARG)
if (!Number.isInteger(VND_ROUND_STEP) || VND_ROUND_STEP < 1 || VND_ROUND_STEP > 1_000_000) {
  fail(`--vnd-round must be a whole number of đồng between 1 and 1000000 (got "${VND_ROUND_ARG}").`)
}

/** One dollar figure from the reference grid → the whole đồng that will be STORED. */
function vndForUsd(usd) {
  return Math.round((usd * VND_PER_USD) / VND_ROUND_STEP) * VND_ROUND_STEP
}

const VND_GROUP = new Intl.NumberFormat('vi-VN')
/** Console formatting only — the app renders through formatMoneyFull(). */
const vnd = (amount) => `${VND_GROUP.format(Number(amount))} ₫`

/** How a stored currency reads. 'usd' is the tell that a row's price is a DOLLAR number
 *  left over from the reverted USD-storage rule, which must be converted, not re-labelled. */
function currencyKind(currency) {
  const symbol = String(currency ?? '').trim().toUpperCase()
  if (!symbol) return 'empty'
  // 'đ'.toUpperCase() === 'Đ'; 'VND' is the ISO code some importers write. Same set as
  // sellablePriceVnd in src/lib/visa-shop.ts.
  if (symbol === '₫' || symbol === 'Đ' || symbol === 'VND') return 'vnd'
  if (symbol === '$' || symbol === 'USD') return 'usd'
  return 'other'
}

// ── env ────────────────────────────────────────────────────────────────────────────
// (The two hard guards are asserted further down, AFTER the --catalogue early exit, so
// the catalogue can be reviewed on a machine with no credentials.)
const PG_URL = process.env.DIRECT_URL || process.env.DATABASE_URL
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY

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

// ── product grid ───────────────────────────────────────────────────────────────────
// The owner's reference grid: 2 entry types × 7 processing speeds, each with its own
// price. ⚠️ IT IS WRITTEN IN DOLLARS BECAUSE THE PROVIDER PUBLISHES IT IN DOLLARS — the
// price that is STORED is the đồng conversion below (vndForUsd), because Listing.price is
// đồng. Do not "fix" this into đồng figures: the grid is the owner's document and the rate
// changes, so the conversion belongs at run time where the rate is an explicit argument.
// This is the ONLY place an amount is written, and only for rows that do not exist yet —
// see "Money" and "Admin edits win" in the header.
//
// The AXES are not restated here: they come from src/lib/visa/speed.ts, so adding a tier
// there fails this script loudly (assertGridCovers) instead of quietly seeding a catalogue
// with a hole in it. Both entry types are 90-day, because that is the only window the
// e-visa engine models (src/lib/visa/schema.ts, MAX_EVISA_VALIDITY_DAYS = 90).
const PRICE_GRID = {
  single: { '1H': 115, '2H': 85, '4H': 61, '1D': 55, '2D': 45, '3D': 42, normal: 30 },
  multiple: { '1H': 140, '2H': 110, '4H': 86, '1D': 80, '2D': 70, '3D': 67, normal: 55 },
}

// Mirrors src/lib/visa-shop.ts → sellablePriceVnd. ADVISORY ONLY: that module is the
// authority on what may be charged, and it cannot be imported here (it pulls in
// `server-only` and the Prisma client). Kept in sync by intent, not by machinery — which
// is exactly why it is used for a WARNING about admin-entered prices and a hard assert
// about this file's own grid, never as a gate on a charge.
const MAX_PRICE_VND = 2_000_000_000
/**
 * Below this, a "đồng" price is almost certainly a DOLLAR number that lost its currency —
 * ~US$4 buys no visa service anywhere, and the one way to arrive here is the f7f8ca40
 * rows (price 115, currency '$'). Not a marketplace rule, a MIGRATION TRIPWIRE: the app
 * would happily sell a 115 ₫ visa, which is why this script refuses to write one.
 */
const SUSPICIOUS_MIN_PRICE_VND = 100_000
function unsellableReason(price) {
  const amount = Number(price)
  if (!Number.isFinite(amount) || amount <= 0) return 'is not a positive amount'
  if (!Number.isInteger(amount)) return 'is not a whole number of đồng (đồng has no minor unit, and the marketplace formatter rounds — so it would be advertised wrong)'
  if (amount > MAX_PRICE_VND) return 'is implausibly large for a visa fee (over 2 tỷ ₫)'
  return null
}

/** The grid must cover the engine's axes EXACTLY — no hole, no orphan. */
function assertGridCovers() {
  const entryTypes = Object.keys(PRICE_GRID)
  const extraEntry = entryTypes.filter((e) => !VISA_ENTRY_TYPES.includes(e))
  const missingEntry = VISA_ENTRY_TYPES.filter((e) => !entryTypes.includes(e))
  if (extraEntry.length || missingEntry.length) {
    fail(
      'The price grid and src/lib/visa/speed.ts disagree on ENTRY TYPES:\n' +
      (missingEntry.length ? `  declared by speed.ts but unpriced: ${missingEntry.join(', ')}\n` : '') +
      (extraEntry.length ? `  priced here but unknown to speed.ts: ${extraEntry.join(', ')}` : ''),
    )
  }
  for (const entryType of VISA_ENTRY_TYPES) {
    const row = PRICE_GRID[entryType]
    const speeds = Object.keys(row)
    const extraSpeed = speeds.filter((s) => !VISA_SPEED_CODES.includes(s))
    const missingSpeed = VISA_SPEED_CODES.filter((s) => !speeds.includes(s))
    if (extraSpeed.length || missingSpeed.length) {
      fail(
        `The price grid and src/lib/visa/speed.ts disagree on SPEEDS for "${entryType}":\n` +
        (missingSpeed.length ? `  declared by speed.ts but unpriced: ${missingSpeed.join(', ')}\n` : '') +
        (extraSpeed.length ? `  priced here but unknown to speed.ts: ${extraSpeed.join(', ')}` : ''),
      )
    }
    for (const speed of VISA_SPEED_CODES) {
      const usd = Number(row[speed])
      if (!Number.isFinite(usd) || usd <= 0) fail(`Grid price for ${entryType}/${speed} ("${row[speed]}") is not a positive dollar amount.`)
      // The assertion is on the ĐỒNG that will actually be stored, not on the dollars the
      // grid is written in: what src/lib/visa-shop.ts has to be able to sell is the
      // converted figure.
      const reason = unsellableReason(vndForUsd(usd))
      if (reason) fail(`Grid price for ${entryType}/${speed} ($${usd} → ${vnd(vndForUsd(usd))} at ${VND_PER_USD}) ${reason}. src/lib/visa-shop.ts would drop such a product from the catalogue, so it could never be bought.`)
      if (vndForUsd(usd) < SUSPICIOUS_MIN_PRICE_VND) fail(`Grid price for ${entryType}/${speed} converts to ${vnd(vndForUsd(usd))}, which is far too little for a visa service. Check --vnd-per-usd=${VND_PER_USD}.`)
    }
  }
}

// ── product copy ───────────────────────────────────────────────────────────────────
const EXTERNAL_PREFIX = 'visa:'
const SHARED_INTRO =
  'Apply for your Vietnam e-visa without leaving the chat. Start a message thread here, upload your passport photo page and a portrait, and our assistant reads the details for you — you confirm what it found and answer only the few questions a passport cannot answer.'
const SHARED_REQUIREMENTS =
  'Before you start: a passport valid for at least six months, one clear portrait photo, a photo page with no glare, and a planned arrival date. You must be outside Vietnam when the application is made.'
// ⚠️ The currency sentence is deliberate buyer-facing copy, not decoration: the price on
// this listing is đồng and the card is charged dollars, so the PDP says so in the same
// words the application flow uses (src/app/dashboard/visa/apply-client.tsx).
const SHARED_FEE =
  'The price shown is the eno assistance service fee, paid securely inside the chat. It is set in Vietnamese đồng; if you pay by card or PayPal, you are charged the equivalent in US dollars and the exact amount is shown before you pay. Ask anything in the thread — a person can take over from the assistant at any time.'

const ENTRY_COPY = {
  single: {
    en: '90-day single entry',
    vi: '90 ngày, nhập cảnh một lần',
    what: 'a 90-day single-entry e-visa application, prepared and checked by our team before it is submitted, with every update posted back into the same thread.',
  },
  multiple: {
    en: '90-day multiple entry',
    vi: '90 ngày, nhập cảnh nhiều lần',
    what: 'a 90-day multiple-entry e-visa application, so you can leave and re-enter Vietnam as often as you need while it is valid. Prepared and checked by our team before it is submitted, with every update posted back into the same thread.',
  },
}

// The two rows the PRE-GRID seed created (one flat-priced product per entry type). They
// are the standard-speed products under the new naming, so a database seeded before the
// grid existed ADOPTS them — id and externalId are re-pointed at the new key instead of a
// second row appearing next to them. Without this, an old $25 row with no visaEntryType /
// visaSpeed would sit in the storefront forever: still messageable, still purchasable,
// bound to no tier at all.
const LEGACY_KEY_FOR = {
  'evisa-90-single-normal': 'evisa-90-single',
  'evisa-90-multiple-normal': 'evisa-90-multiple',
}

// Taxonomy placement (src/lib/taxonomy.ts → category 11 "Services").
const CATEGORY_SLUG = 'services'
const SUBCATEGORY_SLUG = 'visa-legal'
const LISTING_TYPE = 'service' // one of the Services category's declared types
// Whitelisted facet values from that same taxonomy entry, so the products filter like any
// other service listing. visaEntryType/visaSpeed are the PRODUCT's parameters: the app
// reads the tier back out of here (src/lib/visa-shop.ts → readVisaAttributes), which is
// what binds the thing sold to the thing paid for.
const BASE_ATTRIBUTES = { serviceLocation: 'online', providerType: 'business' }

assertGridCovers()

const PRODUCTS = []
for (const entryType of VISA_ENTRY_TYPES) {
  for (const speed of VISA_SPEED_CODES) {
    const spec = VISA_SPEED_SPECS[speed]
    const entry = ENTRY_COPY[entryType]
    if (!spec || !entry) fail(`No copy for ${entryType}/${speed} — src/lib/visa/speed.ts grew an axis this script has no words for.`)
    const key = `evisa-90-${entryType}-${speed.toLowerCase()}`
    const legacyKey = LEGACY_KEY_FOR[key]
    PRODUCTS.push({
      key,
      entryType,
      speed,
      // What gets STORED: đồng. `priceUsd` is kept only so the plan can print the
      // conversion it performed ("$115 → 3.002.000 ₫"), and is never written anywhere.
      priceUsd: PRICE_GRID[entryType][speed],
      price: vndForUsd(PRICE_GRID[entryType][speed]),
      externalId: `${EXTERNAL_PREFIX}${key}`,
      listingId: `visa-${key}`,
      legacyExternalId: legacyKey ? `${EXTERNAL_PREFIX}${legacyKey}` : null,
      legacyListingId: legacyKey ? `visa-${legacyKey}` : null,
      // Titles and turnaround copy are DERIVED from speed.ts, never retyped: the tier's
      // words already exist in two places (that file and the taxonomy facet labels) and
      // were drifting. A third hand-written copy per product would be fourteen more.
      title: `Vietnam e-visa assistance — ${entry.en} · ${spec.label}`,
      titleVi: `Hỗ trợ xin e-visa Việt Nam — ${entry.vi} · ${spec.labelVi}`,
      description: [
        SHARED_INTRO,
        `What you get: ${entry.what}`,
        // No cutoff CLOCK TIMES are written into the stored description on purpose: a
        // description is preserved across re-runs (the admin owns it), so a time baked in
        // here would outlive any change to speed.ts. The live window is computed per
        // request from that file (submissionWindow) and shown in the thread instead.
        spec.cutoffs.length
          ? `Processing: ${spec.turnaround} Daily submission cutoffs apply — the one that applies right now is shown in the thread before you pay.`
          : `Processing: ${spec.turnaround}`,
        SHARED_REQUIREMENTS,
        SHARED_FEE,
      ].join('\n\n'),
      attributes: JSON.stringify({ ...BASE_ATTRIBUTES, visaEntryType: entryType, visaSpeed: speed }),
    })
  }
}

// ── --catalogue: print and stop, before anything can touch env, network or disk ─────
if (has('catalogue')) {
  console.log(`\n${PRODUCTS.length} products — ${VISA_ENTRY_TYPES.length} entry types × ${VISA_SPEED_CODES.length} speeds, one price each`)
  console.log(`prices STORED IN ĐỒNG, converted from the USD reference grid at ${VND_GROUP.format(VND_PER_USD)} ₫ per US$1 (rounded to ${VND_GROUP.format(VND_ROUND_STEP)} ₫)\n`)
  for (const p of PRODUCTS) {
    console.log(`  ${p.key.padEnd(26)} $${String(p.priceUsd).padStart(4)} → ${vnd(p.price).padStart(13)}  ${p.attributes}`)
    console.log(`    ${p.title}`)
    console.log(`    ${p.titleVi}`)
  }
  console.log('')
  // Photos are a runtime question (they depend on the bucket and on rows that already
  // exist), so this screens the COPY only — which is the half a reviewer can check here.
  await publishGateSelfCheck(new Map(), { textsOnly: true })
  console.log('')
  process.exit(0)
}

if (!PG_URL) fail('Set DIRECT_URL (or DATABASE_URL) — run with `node --env-file=.env`.')
if (!SUPABASE_URL || !SUPABASE_SECRET) fail('Set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY (the shop owner is resolved from Supabase auth).')

/**
 * The taxonomy has to offer the same chips this script writes, or the admin cannot set or
 * change a product's tier in the dashboard and the facet bar cannot filter on it.
 * ADVISORY (a warning, not a gate): `sanitizeAttributes` does not validate against the
 * taxonomy, so the attributes below are stored either way and src/lib/visa-shop.ts reads
 * them back fine — what a missing facet breaks is the admin's UI, not the data.
 */
async function checkTaxonomyFacets() {
  let taxonomy
  try {
    ({ TAXONOMY: taxonomy } = await import('../src/lib/taxonomy.ts'))
  } catch (e) {
    warn(`could not read src/lib/taxonomy.ts to check the visa facets (${e instanceof Error ? e.message : e}) — skipping that check.`)
    return
  }
  const facets = taxonomy.find((c) => c.slug === CATEGORY_SLUG)?.facets || []
  for (const [key, values] of [['visaEntryType', VISA_ENTRY_TYPES], ['visaSpeed', VISA_SPEED_CODES]]) {
    const facet = facets.find((f) => f.key === key)
    if (!facet) {
      warn(`src/lib/taxonomy.ts declares no "${key}" facet on "${CATEGORY_SLUG}". The attribute is still written and the app still reads it, but the admin gets no chip to change it in the dashboard.`)
      continue
    }
    if (Array.isArray(facet.subcats) && !facet.subcats.includes(SUBCATEGORY_SLUG)) {
      warn(`the "${key}" facet is scoped to [${facet.subcats.join(', ')}], which does not include "${SUBCATEGORY_SLUG}" — it will not show on these products.`)
    }
    const options = new Set((facet.options || []).map((o) => o.value))
    const missing = values.filter((v) => !options.has(v))
    if (missing.length) {
      warn(`the "${key}" facet offers no option for: ${missing.join(', ')} — products on those tiers cannot be re-selected in the dashboard.`)
    }
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
async function publishGateSelfCheck(imagesByKey, { textsOnly = false } = {}) {
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
    if (!textsOnly && (urls.length || !ALLOW_NO_IMAGE)) {
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
// 3-different-angles rule is for physical goods). Fourteen products do not need fourteen
// files: the search falls back from the product to its entry type to the whole desk, so
// one public/listings/visa-shop.png dresses the entire catalogue. Resolution order:
//   1. --image=<url>  (⚠️ must be a first-party `listings`-bucket URL: the dashboard EDIT
//      path filters images through isListingImageUrl, so a foreign URL is silently
//      dropped there and the edit then fails photo_required)
//   2. public/listings/visa-<key>.(png|jpg|jpeg|webp)            — this exact product
//   3. public/listings/visa-evisa-90-<entryType>.(…)             — every speed of one entry type
//   4. public/listings/visa-shop.(…)                             — the whole desk
//      …uploaded to the public `listings` bucket at a STABLE path, so re-runs reuse the URL
//   5. whatever the existing listing already has (a re-run never blanks a photo)
//   6. nothing → REFUSED by default. A live, paid, first-party listing with no photo
//      contradicts the platform's own publish gate, so seeding one takes an explicit
//      --allow-no-image (dev/staging). The card would render its category-icon tile and
//      the listing could not be edited in the dashboard until a photo was added.
// (Sharing one file across products means those listings share a perceptual hash. That is
// fine here — the app's duplicate guard runs on the CREATE path, which a direct SQL seed
// does not use — but it is why the fallbacks are opt-in files rather than a default.)
const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }
const IMAGE_OVERRIDE = opt('image')
const LISTINGS_BUCKET = 'listings'
const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET, { auth: { persistSession: false, autoRefreshToken: false } })
const canonicalImagePrefix = `${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/${LISTINGS_BUCKET}/`

/** Local artwork files that could dress this product, most specific first. */
function artworkCandidates(product) {
  const out = []
  for (const stem of [`visa-${product.key}`, `visa-evisa-90-${product.entryType}`, 'visa-shop']) {
    for (const ext of Object.keys(IMAGE_TYPES)) {
      const file = path.join(ROOT, 'public/listings', `${stem}.${ext}`)
      if (existsSync(file)) out.push([file, ext])
    }
  }
  return out
}

// One upload per FILE, not per product: a shared fallback image would otherwise be pushed
// to the same object path fourteen times.
const uploadedByFile = new Map()

async function resolveImages(product, existing) {
  if (IMAGE_OVERRIDE) return [IMAGE_OVERRIDE]
  for (const [file, ext] of artworkCandidates(product)) {
    if (uploadedByFile.has(file)) return [uploadedByFile.get(file)]
    // STABLE object path derived from the file name, with the `visa-` prefix dropped so
    // public/listings/visa-evisa-90-single.png keeps the pre-grid path it already had.
    const objectPath = `visa-shop/${path.basename(file).replace(/^visa-/, '')}`
    if (DRY_RUN) {
      const url = `${canonicalImagePrefix}${objectPath}`
      uploadedByFile.set(file, url)
      return [url]
    }
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
    const url = supabase.storage.from(LISTINGS_BUCKET).getPublicUrl(objectPath).data.publicUrl
    uploadedByFile.set(file, url)
    return [url]
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

// ── row lookup ─────────────────────────────────────────────────────────────────────
const LISTING_COLUMNS = `id, "sellerId", title, "titleVi", description, price, currency, location, city, images, status, attributes, "externalId"`

/**
 * The row this product already owns, or null — tried in decreasing order of confidence:
 *   1. the product's own marker (the normal case);
 *   2. the PRE-GRID marker it supersedes (adoption, see LEGACY_KEY_FOR);
 *   3. the deterministic row id — otherwise a row whose externalId was cleared
 *      (dashboard/API edit, partial restore) is invisible here and the INSERT dies on a
 *      primary-key collision instead of adopting it;
 *   4. the pre-grid row id, same reason.
 * `claimed` guards against two products resolving to the same row, which would silently
 * seed thirteen products and update one twice.
 */
async function findExistingListing(client, sellerId, product, claimed) {
  const attempts = [
    ['externalId', product.externalId, null],
    ['externalId', product.legacyExternalId, `adopted the pre-grid row ${product.legacyExternalId} — it is this product now`],
    ['id', product.listingId, `its ${product.externalId} marker was missing`],
    ['id', product.legacyListingId, `adopted the pre-grid row ${product.legacyListingId} — it is this product now`],
  ].filter(([, value]) => !!value)

  for (const [column, value, note] of attempts) {
    const row = column === 'externalId'
      ? (await client.query(`SELECT ${LISTING_COLUMNS} FROM "Listing" WHERE "sellerId" = $1 AND "externalId" = $2 LIMIT 1`, [sellerId, value])).rows[0]
      : (await client.query(`SELECT ${LISTING_COLUMNS} FROM "Listing" WHERE id = $1 LIMIT 1`, [value])).rows[0]
    if (!row) continue
    if (row.sellerId !== sellerId) {
      throw new Error(`Listing "${row.id}" belongs to seller ${row.sellerId} — refusing to touch another shop's row.`)
    }
    if (claimed.has(row.id)) {
      throw new Error(`Listing "${row.id}" matches two products at once (${product.key} is the second). Fix the externalId markers by hand — a seed must never update one row twice.`)
    }
    claimed.add(row.id)
    return { row, note }
  }
  return { row: null, note: null }
}

// ── preserve-admin-edits helpers ───────────────────────────────────────────────────
/** Key-order-independent JSON, so a re-serialised attributes blob does not read as an edit. */
function stableJson(value) {
  const raw = value === null || value === undefined ? '' : String(value)
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return raw
    return JSON.stringify(Object.fromEntries(Object.entries(parsed).sort(([a], [b]) => a.localeCompare(b))))
  } catch {
    return raw
  }
}

const SAME_AS = {
  price: (a, b) => Number(a) === Number(b),
  attributes: (a, b) => stableJson(a) === stableJson(b),
}
const isSame = (column, current, desired) => (SAME_AS[column] || ((a, b) => String(a) === String(b)))(current, desired)

/** The two facets that bind a product to a tier, read the way the app reads them. */
function readVisaFacets(attributes) {
  try {
    const parsed = JSON.parse(String(attributes ?? ''))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return { entryType: parsed.visaEntryType, speed: parsed.visaSpeed }
  } catch {
    return {}
  }
}

// ── main ───────────────────────────────────────────────────────────────────────────
const gridPrices = PRODUCTS.map((p) => p.price)

console.log(`\neno visa shop — ${DRY_RUN ? 'DRY RUN' : 'seeding'}`)
console.log(`  owner    ${OWNER_EMAIL}`)
console.log(`  products ${PRODUCTS.length} (${VISA_ENTRY_TYPES.length} entry types × ${VISA_SPEED_CODES.length} speeds), each with its OWN price`)
console.log(`  rate     ${VND_GROUP.format(VND_PER_USD)} ₫ per US$1 (--vnd-per-usd), rounding to ${VND_GROUP.format(VND_ROUND_STEP)} ₫`)
console.log(`  prices   ${vnd(Math.min(...gridPrices))}–${vnd(Math.max(...gridPrices))} converted from the USD grid in this script; existing rows keep the dashboard's price`)
console.log(`  status   ${STATUS}\n`)

await checkTaxonomyFacets()

if (!process.env.VISA_SERVICE_FEE_USD) {
  warn('VISA_SERVICE_FEE_USD is not set, so visaPaymentsConfig() is null and checkout stays DORMANT. (It is NOT a price — pricing is per product, on Listing.price — it is the switch that says the owner has turned payments on.) Until it is set, these products advertise prices nothing can charge.')
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
  const preClaimed = new Set()
  for (const product of PRODUCTS) {
    let existingImages = []
    if (preSeller) {
      // Same lookup the upsert uses, so a row that lost its marker (or predates the grid)
      // still contributes its existing photo instead of reading as "no artwork".
      const { row } = await findExistingListing(db, preSeller.id, product, preClaimed)
      try {
        const parsed = JSON.parse(row?.images || '[]')
        if (Array.isArray(parsed)) existingImages = parsed.filter((u) => typeof u === 'string')
      } catch { existingImages = [] }
    }
    const urls = await resolveImages(product, existingImages)
    imagesByKey.set(product.key, urls)
    if (!urls.length) {
      const message = `no artwork for ${product.key} — drop a photo at public/listings/visa-shop.png (dresses every product), public/listings/visa-evisa-90-${product.entryType}.png (one entry type), or public/listings/visa-${product.key}.png (this product only); or pass --image=<url>. Pass --allow-no-image to seed it anyway (the card renders its category-icon tile, and the listing cannot be edited in the dashboard until it has a photo: assertEnoughAngles → photo_required).`
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
  const claimed = new Set()

  for (const product of PRODUCTS) {
    const { row: existing, note } = await findExistingListing(db, seller.id, product, claimed)
    if (existing && note) console.log(`  adopted  ${existing.id} (${note})`)

    // EDITABLE fields: what the shop may legitimately have rewritten in the dashboard.
    // A seed must not silently undo the owner's work, so on a re-run these are kept
    // whenever they differ — unless --force (or the value is empty, or --status was
    // passed explicitly). PRICE and ATTRIBUTES are in here deliberately: the price is the
    // owner's commercial decision the moment the row exists, and the two visa chips are
    // the product's identity, which the admin re-sets in the dashboard like any facet.
    // Everything else below is a structural invariant of a visa product and is always
    // reconciled.
    const editable = {
      title: product.title,
      titleVi: product.titleVi,
      description: product.description,
      price: product.price,
      location: SHOP_LOCATION,
      city: SHOP_CITY,
      images: JSON.stringify(imagesByKey.get(product.key) || []),
      status: STATUS,
      attributes: product.attributes,
    }
    const final = { ...editable }
    const kept = []
    if (existing) {
      for (const [column, desired] of Object.entries(editable)) {
        const current = existing[column]
        const isEmpty = current === null || current === undefined || current === ''
          || (column === 'images' && current === '[]')
          || (column === 'attributes' && stableJson(current) === '{}')
        const forced = FORCE || (column === 'status' && !!STATUS_ARG)
        if (forced || isEmpty) continue
        if (isSame(column, current, desired)) continue
        final[column] = current
        kept.push(column)
      }
      if (kept.length) {
        console.log(`  kept     ${product.key}: ${kept.join(', ')} as edited in the dashboard (use --force to overwrite)`)
      }
      // ── The row's price, read in the currency the row actually carries ─────────────
      //
      // ⚠️ THE MIGRATION HAZARD THIS BLOCK EXISTS FOR. Every seeded row is re-stamped
      // currency '₫' below. A row written by the reverted USD-storage rule (f7f8ca40)
      // holds price=115, currency='$' — and 115 is preserved as an admin edit, because it
      // differs from the grid's đồng figure. Re-stamping that row without touching the
      // number puts a 115 ₫ (US$0.004) visa on sale. So a dollar price is CONVERTED at the
      // rate this run was given, which is also the only honest reading of it: the admin's
      // commercial decision was "$115", and $115 at today's rate is what that means in đồng.
      const kind = currencyKind(existing.currency)
      const priceKept = kept.includes('price')
      if (priceKept && kind === 'usd') {
        const dollars = Number(final.price)
        final.price = vndForUsd(dollars)
        warn(`${product.key}: the row's price (${dollars}) was stored in DOLLARS ("${existing.currency}") and this seed stores đồng. Converting at --vnd-per-usd=${VND_PER_USD}: $${dollars} → ${vnd(final.price)}. (Re-labelled instead of converted it would have become a ${vnd(dollars)} visa.) Re-run with --force to reset it to the grid price ${vnd(product.price)} instead.`)
      } else if (priceKept && kind === 'other') {
        throw new Error(`${product.key}: the row's price (${existing.price}) is stored in "${existing.currency}", which this script cannot convert to đồng — and re-stamping the row '₫' would silently reprice it. Fix the price in the dashboard, or re-run with --force to reset it to ${vnd(product.price)}.`)
      } else if (kind === 'usd' || kind === 'other') {
        warn(`${product.key}: the row's currency was "${existing.currency}" and is being re-stamped '₫' (visa products are priced in đồng). Its price is this run's đồng figure, so nothing is mis-priced.`)
      }
      if (priceKept) {
        // Not a mismatch to fix — Listing.price IS what checkout converts and charges, so
        // the kept amount is correct by construction. Printed so a re-run never *looks*
        // like it repriced the catalogue.
        console.log(`  price    ${product.key}: keeping ${vnd(final.price)} (grid says ${vnd(product.price)})`)
      }
      // ⚠️ WARNS AND WRITES IT ANYWAY, on purpose — and the contrast with the throw below
      // is the whole point. An UNSELLABLE price (fractional, non-positive, absurdly large)
      // is one src/lib/visa-shop.ts REFUSES to sell: the row is written, dropped from the
      // catalogue, and the failure the admin sees is a missing product. Nobody is charged
      // wrongly, and failing the run instead would block the other thirteen products over
      // one bad row. A SELLABLE-but-wrong price is the opposite case and does throw.
      const priceProblem = unsellableReason(final.price)
      if (priceProblem) {
        warn(`${product.key}: the price on the row (${final.price}) ${priceProblem} — src/lib/visa-shop.ts drops such a product from the catalogue (sellablePriceVnd), so it is written but NOBODY CAN BUY IT until you fix it in the dashboard (or re-run with --force to reset it to ${vnd(product.price)}).`)
      }
      // The tripwire, applied to what is about to be WRITTEN. Unlike the warning above,
      // this price IS sellable — the app would put a US$0.004 visa on sale without
      // complaint — which is exactly why it stops the run instead of logging a line.
      if (priceKept && Number(final.price) > 0 && Number(final.price) < SUSPICIOUS_MIN_PRICE_VND) {
        throw new Error(`${product.key}: the row's price would be stored as ${vnd(final.price)} — about US$${(Number(final.price) / VND_PER_USD).toFixed(2)}, which no visa service costs. That is what a dollar amount looks like once it is read as đồng. Fix the price in the dashboard, or re-run with --force to reset it to ${vnd(product.price)}.`)
      }
      const facets = readVisaFacets(final.attributes)
      if (facets.entryType !== product.entryType || facets.speed !== product.speed) {
        warn(`${product.key}: the row's attributes say entry=${facets.entryType ?? 'unset'} / speed=${facets.speed ?? 'unset'}, not ${product.entryType}/${product.speed}. The app sells what the ATTRIBUTES say (that binding is what stops a buyer paying the cheap tier for a different service), so this row is now a different product than its seed key suggests. Re-run with --force to reset it.`)
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
      // ĐỒNG, always — see "Money" in the header.
      ['price', final.price],
      // Empty unit: <Price> renders "3.002.000 đ" and appends " / <unit>" for anything else.
      ['priceUnit', ''],
      // Structural, never editable: src/lib/visa-shop.ts only sells ₫/Đ/VND
      // (sellablePriceVnd), and the app's own edit path never writes this column. ⚠️ The
      // price beside it has already been read in the row's OWN currency above — never move
      // this stamp above that block, or a dollar amount becomes a đồng amount in place.
      ['currency', '₫'],
      ['location', final.location],
      ['city', final.city],
      ['images', final.images],
      ['categoryId', category.id],
      ['subcategorySlug', SUBCATEGORY_SLUG],
      ['listingType', LISTING_TYPE],
      ['attributes', final.attributes],
      ['searchText', searchText],
      ['sellerTrustScore', seller.trustScore],
      ['status', final.status],
      // Re-stamped on every run: the marker IS the seed's idempotency key, so a row that
      // lost it (or carries the pre-grid one) gets this product's key back.
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
      summary.push({ product, id: existing.id, action: 'updated', price: final.price, images: final.images })
    } else {
      const insertFields = [...fields, ['id', product.listingId], ['sellerId', seller.id]]
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
      seededIds.push(product.listingId)
      summary.push({ product, id: product.listingId, action: 'created', price: final.price, images: final.images })
    }
  }

  // rankScore from the ONE shared formula (imported above, never re-typed).
  await db.query(`UPDATE "Listing" SET "rankScore" = ${rankScoreExprSql()} WHERE id = ANY($1)`, [seededIds])

  // Anything else on this storefront is a product the ADMIN uploaded through the ordinary
  // dashboard — which is the whole point of the model, so it is reported, not flagged. The
  // app treats every listing this seller owns as a visa product (membership is the
  // storefront, not the marker), so the one case that IS a problem is a row with no tier
  // on it: it is for sale, it is messageable, and nothing binds it to what gets applied
  // for. Listed here because a seed run is the only moment anyone looks at the shop as a
  // whole.
  const others = (await db.query(
    `SELECT id, title, price, currency, attributes FROM "Listing" WHERE "sellerId" = $1 AND NOT (id = ANY($2)) ORDER BY id`,
    [seller.id, seededIds],
  )).rows
  if (others.length) console.log(`\n  ${others.length} other listing(s) on this storefront (admin-uploaded — this seed does not manage them):`)
  for (const other of others) {
    const facets = readVisaFacets(other.attributes)
    console.log(`  also     ${other.id.padEnd(30)} ${other.price} ${other.currency}  entry=${facets.entryType ?? 'unset'} speed=${facets.speed ?? 'unset'}`)
    if (currencyKind(other.currency) !== 'vnd') {
      warn(`"${other.id}" (${other.title}) is priced in "${other.currency}", not đồng. src/lib/visa-shop.ts sells ₫ only (sellablePriceVnd) — it drops this row from the catalogue rather than reinterpreting the number, so nobody can buy it until the price is re-entered in đồng.`)
    }
    if (!facets.entryType || !facets.speed) {
      warn(`"${other.id}" (${other.title}) is on the visa storefront with no ${!facets.entryType ? 'visaEntryType' : ''}${!facets.entryType && !facets.speed ? '/' : ''}${!facets.speed ? 'visaSpeed' : ''} attribute. It can still be bought, but nothing binds the payment to a tier — set the chips on it in the dashboard, or hide it.`)
    }
  }

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
    console.log(
      `  ${row.action.toUpperCase().padEnd(8)} ${row.id.padEnd(30)} ` +
      `${row.product.entryType.padEnd(9)} ${row.product.speed.padEnd(6)} ` +
      `${vnd(row.price).padStart(13)}  ${count} photo(s)`,
    )
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
