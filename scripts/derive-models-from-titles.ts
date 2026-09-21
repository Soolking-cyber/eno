/**
 * DERIVE MODELS FROM TITLES — fill `Listing.model` for branded rows that have none, so the brand
 * cascade can offer a lineup for them.
 *
 *   npx tsx scripts/derive-models-from-titles.ts --dry            # print, write NOTHING
 *   npx tsx scripts/derive-models-from-titles.ts --dry --brand nike
 *   npx tsx scripts/derive-models-from-titles.ts --write          # the only writing form
 *
 * ⛔ DRY BY DEFAULT. `--write` is the only way to touch the database and it snapshots first.
 *
 * WHY THIS EXISTS: 5,591 branded `sports` listings carry a brand and NO model, so the cascade has
 * nothing to build a lineup from — Nike, Adidas, Under Armour, Hoka, Puma all fall back to the
 * flat grid. Their lineups are real (Air Max, Pegasus, Charged, Mach); they just live in the title.
 *
 * ⚠️ THE TITLES ARE REGULAR, WHICH IS WHY CODE CAN DO THIS AND A MODEL IS NOT NEEDED FOR THE
 * EXTRACTION. Measured over the live catalogue, they are overwhelmingly:
 *
 *     [Men's|Women's|Unisex]  <Brand>  <MODEL>  <product type>  - <colour>
 *     "Men's On Running Cloudrunner 3 Running Shoes - Gray"  ->  "Cloudrunner 3"
 *     "Women's Asics Gel-Resolution X Tennis Shoes - White"  ->  "Gel-Resolution X"
 *     "Women's HOKA Mach 7 Wide Running Shoes - Multicolor"  ->  "Mach 7 Wide"
 *
 * so the model is what remains once the four known parts are removed. Asking a model to EXTRACT
 * free text would be the wrong tool anyway — the decisions model answers questions and picks from
 * lists; it does not return strings.
 */
import { config } from 'dotenv'
import { writeFileSync, mkdirSync } from 'node:fs'
import type { PrismaClient } from '../src/generated/prisma/client'

config({ path: '.env', quiet: true })
config({ path: '.env.local', quiet: true })

let db: PrismaClient

/** Leading audience words, in both languages the catalogue uses. */
const LEAD = /^((men|women|kid|kids|boy|boys|girl|girls|unisex|youth|junior|baby)'?s?\s+|nam\s+|n[uữ]\s+|tr[eẻ] em\s+|giày\s+|áo\s+|quần\s+)+/i

/**
 * A size or a product word sitting where the model should be.
 * ⛔ FROM THE DRY RUN: Casio came out as "Unisex Watch 35 mm UTP-1302PD" — the audience word ran
 * AFTER the brand, so `LEAD` never saw it, and the real model is the SKU at the end. Stripping the
 * size and the bare category noun leaves it.
 */
const SPEC_NOISE = /\b\d+(\.\d+)?\s*(mm|cm|inch|in|ml|l)\b/gi
const CATEGORY_NOUN = /^((men|women|kid|kids|unisex|youth|junior|baby)'?s?\s+)?(watch|watches|smartwatch|sunglasses|eyewear|perfume|fragrance)\s+/i

/**
 * The product-type tail. Removing it is what turns "Cloudrunner 3 Running Shoes" into
 * "Cloudrunner 3".
 * ⚠️ MATCHED AT THE END ONLY, AND REPEATEDLY. "Brief-Lined Volley Boardshort" is three type words
 * in a row; one pass would leave two of them glued to the model.
 */
const TYPE = new RegExp(
  '\\s+(' + [
    'running shoes', 'training shoes', 'tennis shoes', 'basketball shoes', 'walking shoes',
    'football boots', 'golf shoes', 'trail shoes', 'court shoes', 'lifestyle shoes',
    'shoes', 'sneakers', 'trainers', 'sandals', 'slides', 'flip flops', 'boots', 'cleats',
    't-shirt', 'tee', 'polo', 'shirt', 'tank top', 'crop top', 'top', 'hoodie', 'sweatshirt',
    'jacket', 'vest', 'gilet', 'pullover', 'jumper', 'sweater', 'base layer',
    'shorts', 'boardshort', 'boardshorts', 'pants', 'trousers', 'joggers', 'tights',
    'leggings', 'briefs', 'trunks', 'jammers', 'swimsuit', 'swimshorts', 'bra', 'sports bra',
    'socks', 'cap', 'hat', 'beanie', 'visor', 'gloves', 'backpack', 'bag', 'duffel bag',
    'yoga mat', 'mat', 'ball', 'racket', 'racquet', 'goggles', 'towel', 'bottle',
    'calfsleeve', 'sleeve', 'headband', 'wristband', 'belt', 'strap',
    // Added after the first dry run left them glued to the model: "Hopara 2 Hiking",
    // "Everyrun Short", "Adi365 Running", "Biofuse 2.0 Goggle", "Plain Moulded Silicone Swim".
    'hiking', 'running', 'training', 'swim', 'swimming', 'goggle', 'clog', 'clogs',
    'short', 'sleeve 2.0', 'poly', 'tt', 'match', 'one piece', 'rashguard',
  ].join('|') + ')$', 'i')

/** The trailing " - Colour" (or a Vietnamese colour) the importer appends. */
/**
 * ⛔ THE SPACES ARE MANDATORY. With `\s*` the dash inside a hyphenated model matched, and
 * "Gel-Resolution X" — the example in this file's own docstring — came out as "Gel". The importer
 * always writes " - Colour" with spaces, so requiring them keeps hyphenated names intact.
 */
const COLOUR = /\s+[-–—]\s+[^-–—]{2,28}$/

/**
 * Marketing words that are not part of a model name. Trailing only — "Nike Pegasus 42 Premium"
 * should become "Pegasus 42", but "Ultra" in "Ultra Nitro 7" is the line itself.
 */
const FLUFF = /\s+(printed|graphic|premium|classic|essential|essentials|core|basic|logo|oversized|slim fit|regular fit|wide|long sleeve|short sleeve|sleeveless|mock|full zip|half zip|1\/2 zip|2in1|\d+\s*inch|\d+in)$/i

/** Brand aliases as they appear inside titles, where the slug will not match verbatim. */
const BRAND_IN_TITLE: Record<string, string[]> = {
  'on-running': ['on running', 'on'],
  'under-armour': ['under armour', 'under armour®'],
  'nike-swim': ['nike swim', 'nike'],
  'the-north-face': ['the north face', 'north face'],
  'new-balance': ['new balance'],
}

export function deriveModel(title: string, brandSlug: string): string | null {
  let t = title.trim()

  // 1. the trailing colour, then the audience prefix
  t = t.replace(COLOUR, '').trim()
  t = t.replace(LEAD, '').trim()

  /**
   * 2. everything up to and including the brand goes. ⚠️ LONGEST ALIAS FIRST: "on running" must
   * beat the bare "on", or "On Running Cloudrunner 3" keeps a stray "running".
   */
  const names = [...(BRAND_IN_TITLE[brandSlug] ?? []), brandSlug.replace(/-/g, ' '), brandSlug]
    .sort((a, b) => b.length - a.length)
  for (const n of names) {
    const i = t.toLowerCase().indexOf(n.toLowerCase())
    if (i !== -1) { t = t.slice(i + n.length).trim(); break }
  }

  // 2b. size/category noise left behind when the audience word follows the brand (Casio-shaped)
  t = t.replace(SPEC_NOISE, ' ').replace(/\s+/g, ' ').trim()
  t = t.replace(CATEGORY_NOUN, '').trim()

  // 3. the product-type tail, repeatedly, then trailing marketing words
  for (let i = 0; i < 4; i++) { const next = t.replace(TYPE, '').trim(); if (next === t) break; t = next }
  for (let i = 0; i < 3; i++) { const next = t.replace(FLUFF, '').trim(); if (next === t) break; t = next }

  t = t.replace(/[®™]/g, '').replace(/\s+/g, ' ').replace(/^[-–—\s]+|[-–—\s]+$/g, '').trim()

  /**
   * ⚠️ REFUSE RATHER THAN GUESS. A result that is empty, a lone number, or a sentence is not a
   * model name — writing one would put junk in the picker for everyone, and a null simply leaves
   * the row where it already is.
   */
  if (t.length < 2 || t.length > 40) return null
  if (!/[\p{L}]/u.test(t)) return null
  if (t.split(/\s+/).length > 5) return null
  return t
}

/**
 * Fold the spellings of ONE product so the picker does not offer it twice.
 * ⛔ MEASURED ON THE FIRST DRY RUN: Crocs produced "Classic Clogs"(23) AND "Classic Clog"(18),
 * Speedo "Biofuse 2.0 Goggle"(12) AND "Biofuse 2.0"(6) — the same product, counts split, exactly
 * the failure the alias layer exists to prevent on the electronics side.
 */
export function foldKey(model: string): string {
  return model.toLowerCase().replace(/[()®™]/g, ' ').replace(/s\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
}

async function main() {
  const argv = process.argv
  const write = argv.includes('--write')
  const only = argv.includes('--brand') ? argv[argv.indexOf('--brand') + 1] : null
  db = (await import('../src/lib/db')).db

  /**
   * ⛔ SPORTS AND FASHION ONLY, AND THE FIRST DRY RUN IS WHY. Run across every category it also
   * "derived" models for electronics accessories that genuinely have none, producing entries like
   * "Wireless Keyboard with Numeric Keypad", "HOMEPOD MINI BLUETOOTH SPEAKER" and
   * "HD9303 1.2 Liter Electric Kettle" — those are product NAMES, not models, and writing them
   * would fill the picker with one-row lines nobody can use. A sports title names a MODEL
   * ("Cloudrunner 3") because that is how the industry sells; an accessory title does not.
   */
  const rows = await db.$queryRaw<{ id: string; title: string; brandSlug: string; cat: string }[]>`
    SELECT l.id, l.title, l."brandSlug", c.slug AS cat
    FROM "Listing" l JOIN "Category" c ON c.id = l."categoryId"
    WHERE l.verified AND l.status = 'active' AND l."listingType" = 'sell'
      AND l.model IS NULL AND l."brandSlug" IS NOT NULL AND l."brandSlug" <> ''
      AND c.slug IN ('sports', 'fashion-beauty', 'hobbies-sports')`

  const work = rows.filter((r) => !only || r.brandSlug === only)
  const raw: { id: string; brandSlug: string; model: string; title: string }[] = []
  let refused = 0
  for (const r of work) {
    const m = deriveModel(r.title, r.brandSlug)
    if (m) raw.push({ id: r.id, brandSlug: r.brandSlug, model: m, title: r.title })
    else refused++
  }
  /**
   * Canonicalise per brand: everything sharing a fold key becomes the longest spelling, which is
   * the one a human wrote out in full ("Classic Clogs" over "Classic Clog").
   */
  const canon = new Map<string, string>()
  for (const d of raw) {
    const k = `${d.brandSlug}|${foldKey(d.model)}`
    const cur = canon.get(k)
    if (!cur || d.model.length > cur.length) canon.set(k, d.model)
  }
  let mapped = raw.map((d) => ({ ...d, model: canon.get(`${d.brandSlug}|${foldKey(d.model)}`) ?? d.model }))
  /**
   * ⚠️ A WHOLE-WORD SUFFIX IS THE SAME PRODUCT. Nike came out of the dry run with BOTH
   * "Air Zoom Pegasus 42"(10) and "Pegasus 42"(7) — one shoe, the counts split, the picker
   * offering it twice. Folding the shorter into the longer within ONE brand fixes it; across
   * brands it would be nonsense, which is why the key is brand-scoped.
   */
  const perBrand = new Map<string, Set<string>>()
  for (const d of mapped) {
    if (!perBrand.has(d.brandSlug)) perBrand.set(d.brandSlug, new Set())
    perBrand.get(d.brandSlug)!.add(d.model)
  }
  const suffixOf = new Map<string, string>()
  for (const [brand, names] of perBrand) {
    const sorted = [...names].sort((a, b) => b.length - a.length)
    for (const short of sorted) {
      /**
       * ⛔ ONLY FOLD A NAME THAT CARRIES A GENERATION NUMBER. Without this the rule ate Adidas's
       * "Adizero"(11) into "Running X Adizero"(12) — Adizero is the FAMILY, the other is one
       * collab inside it, and the merge buried a whole line under a single shoe. "Pegasus 42" is
       * safe to fold into "Air Zoom Pegasus 42" precisely because the 42 makes it one product
       * rather than a family. A digit is the difference, and it is the same distinction the
       * electronics side draws between a line and a generation.
       */
      if (!/\d/.test(short)) continue
      const longer = sorted.find((l) => l !== short && l.toLowerCase().endsWith(` ${short.toLowerCase()}`))
      if (longer) suffixOf.set(`${brand}|${short}`, longer)
    }
  }
  mapped = mapped.map((d) => ({ ...d, model: suffixOf.get(`${d.brandSlug}|${d.model}`) ?? d.model }))
  const derived = mapped

  const byBrand = new Map<string, Map<string, number>>()
  for (const d of derived) {
    if (!byBrand.has(d.brandSlug)) byBrand.set(d.brandSlug, new Map())
    const m = byBrand.get(d.brandSlug)!
    m.set(d.model, (m.get(d.model) ?? 0) + 1)
  }

  console.log(`${work.length} branded rows with no model · ${derived.length} derived · ${refused} refused\n`)
  for (const [brand, models] of [...byBrand.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 10)) {
    const top = [...models.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    console.log(`${brand.padEnd(16)} ${models.size} distinct → ${top.map(([m, n]) => `${m}(${n})`).join('  ')}`)
  }

  mkdirSync('data', { recursive: true })
  writeFileSync('data/derived-models.json', JSON.stringify(derived, null, 2))
  console.log(`\nfull proposal → data/derived-models.json`)

  if (!write) { console.log('--dry (default): nothing written'); await db.$disconnect(); return }

  // ⛔ SNAPSHOT BEFORE THE FIRST WRITE. Every row here currently has model = NULL, so the undo is
  // "set these ids back to NULL" — but the id list has to exist on disk before anything changes.
  writeFileSync('data/derived-models-undo.json', JSON.stringify(derived.map((d) => d.id), null, 2))
  let done = 0
  for (let i = 0; i < derived.length; i += 25) {
    const batch = derived.slice(i, i + 25)
    // ⚠️ Per-row updates in a bounded Promise.all, NOT one $transaction: a transaction over
    // thousands of rows exhausted the connection pool and timed out at 5,140ms on this database.
    await Promise.all(batch.map((d) => db.listing.update({ where: { id: d.id }, data: { model: d.model } })))
    done += batch.length
    if (done % 500 === 0) console.log(`  ${done}/${derived.length}`)
  }
  console.log(`wrote ${done} · undo list → data/derived-models-undo.json`)
  await db.$disconnect()
}

if (process.argv[1]?.includes('derive-models-from-titles')) {
  main().catch(async (e) => { console.error(e); await db?.$disconnect(); process.exit(1) })
}
