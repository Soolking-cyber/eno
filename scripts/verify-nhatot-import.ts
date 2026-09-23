/**
 * Read-only check on the Nhà Tốt reference-listing import (scripts/import-nhatot-com.ts).
 * verify-rever-import.ts, parametrised for this seller, plus the checks this source adds: the
 * outbound host pin, photos that are ours (never a cdn.chotot.com hotlink) and at least the
 * category's publish floor of DISTINCT photos, in-country pins, the rent unit, the vn-units city
 * spelling, the district form, no door/alley number (by a check INDEPENDENT of the importer's
 * sanitiser), a postedAt never in the future, and the publish-guard contact screen re-run over what
 * is actually stored.
 *
 * Run: set -a; . ./.env; set +a; PGOPTIONS='-c default_transaction_read_only=on' npx tsx scripts/verify-nhatot-import.ts
 * Exit status is the verdict: non-zero on a failed precondition OR any invariant failure.
 */
import { pathToFileURL } from 'node:url'
import vnUnits from '../src/data/vn-units.json'
import { isOverlayImageUrl } from '../src/lib/image-mark-url'
import { countDistinctAngles } from '../src/lib/image-hash-url'
import { containsContactInfo, findBannedWord, minPhotosFor } from '../src/lib/publish-guard'
import { containsPhoneNumber } from '../src/lib/phone'
import {
  NHATOT_CATEGORY_SLUG, NHATOT_INTRO_EN, NHATOT_INTRO_VI, NHATOT_PRICE_UNIT, NHATOT_SELLER_ID, NHATOT_SELLER_NAME,
  isNhatotAffiliateUrl,
} from '../src/lib/nhatot-listing'

/**
 * ⛔ THE CITY IS THE vn-units `name` OF ONE OF THE THREE PROVINCES — read from the data file here,
 * not from the importer's constant, so a wrong constant fails this check instead of defining it.
 */
const CITY_OK = new Set<string>((vnUnits as { code: string; name: string }[]).filter((u) => ['79', '01', '48'].includes(u.code)).map((u) => u.name))

/**
 * ⛔ AN INDEPENDENT DOOR-NUMBER CHECK. It never calls the importer's nhatotStreetName: on 2026-09-24
 * this script passed a published 'Đường Kiệt 64 Trần Đình Tri' because it audited the sanitiser by
 * re-running the sanitiser. This is a separate, blunter rule over the STORED value:
 *  - no digit of any script, unless the whole value is one of the numbered-name shapes below
 *    (none of which contains a named street for a door number to belong to);
 *  - no alley/door word anywhere, whatever tone it is typed with — hẻm/hẽm, kiệt, ngõ/ngỏ, ngách, số
 *    (and the unmarked forms), or 'k'/'sn' glued to a number;
 *  - nothing but Latin letters, spaces and . ' - outside those shapes (so no '/', '#', ',', and no
 *    Cyrillic look-alike).
 * Returns why the value fails, or null.
 */
const SAFE_NUMBERED = [
  /^đường\s+số\s+\d{1,3}[a-z]?$/iu,
  /^đường\s+\d{1,3}[a-z]?$/iu,
  /^(?:đường\s+)?(?:quốc\s+lộ|ql|tỉnh\s+lộ|tl|hương\s+lộ|đường\s+tỉnh|đt)\s*\d{1,3}[a-z]?$/iu,
  /^(?:(?:đường|phố)\s+)?\d{1,2}\s+tháng\s+\d{1,2}$/iu,
  /^(?:đường|phố)\s+\d{1,2}\s*\/\s*\d{1,2}$/iu,
]
/** Door words on the value with its TONE marks removed (sắc/huyền/hỏi/ngã/nặng; vowel marks kept, so
 *  'Ngô' is not 'ngo'): a misspelt 'hẽm' or 'ngỏ' is still an alley. */
const DOOR_WORD = /(?:^|[^\p{L}\p{M}])(?:hem|kiêt|kiet|ngo|ngach|sô|so|sn)(?=$|[^\p{L}\p{M}])|(?:^|[^\p{L}\p{M}])(?:k|sn|no\.?)\s*\d/u
const TONE_MARKS = /[\u0300\u0301\u0303\u0309\u0323]/g
export function streetValueProblem(value: string): string | null {
  const v = value.normalize('NFC').trim()
  if (SAFE_NUMBERED.some((re) => re.test(v))) return null
  if (DOOR_WORD.test(v.normalize('NFD').replace(TONE_MARKS, '').normalize('NFC').toLowerCase())) return `alley/door word: "${value}"`
  /** Letters, marks, space and . ' - only — every digit (any script) and '/', '#', ',' fall outside it. */
  if (/[^\p{L}\p{M} .'’-]/u.test(v)) return `digit or symbol outside a numbered-street shape: "${value}"`
  /** …and every letter Latin-script: a Cyrillic look-alike would hide a door word from the check above. */
  if ([...v].some((c) => /\p{L}/u.test(c) && !/\p{Script=Latin}/u.test(c))) return `non-Latin letter: "${value}"`
  return null
}
/** Every "Street:" / "Đường:" fact line in a description, checked by streetValueProblem. */
export function streetLineProblems(description: string | null): string[] {
  return [...(description ?? '').matchAll(/^(?:Street|Đường): (.*)$/gm)].map((m) => streetValueProblem(m[1])).filter((p): p is string => p !== null)
}
/**
 * The Building / Dự án value, checked on its own terms (not with the importer's function): no digit
 * of any script, no alley/door word in any tone (DOOR_WORD, above, on the tone-folded value), Latin
 * letters only. Returns why it fails, or null.
 */
export function projectValueProblem(value: string): string | null {
  const v = value.normalize('NFC').trim()
  if (/\p{N}/u.test(v)) return `digit in the building line: "${value}"`
  if (DOOR_WORD.test(v.normalize('NFD').replace(TONE_MARKS, '').normalize('NFC').toLowerCase())) return `alley/door word in the building line: "${value}"`
  if ([...v].some((c) => /\p{L}/u.test(c) && !/\p{Script=Latin}/u.test(c))) return `non-Latin letter in the building line: "${value}"`
  return null
}
/**
 * A '506/35'-style door number on ANY fact line but the street's (whose numbered shapes include
 * 'Đường 3/2' and are checked by streetValueProblem): ward, former ward, district, building, type…
 * The rent line's 'đ/month' has no digit after the slash, so it never matches.
 */
export function slashDoorLineProblems(description: string | null): string[] {
  return [...(description ?? '').matchAll(/^([^:\n]+): (.*)$/gm)]
    .filter((m) => !/^(?:Street|Đường)$/.test(m[1]) && /\d+\s*\/\s*\d+/.test(m[2]))
    .map((m) => `door number on the "${m[1]}" line: "${m[2].slice(0, 80)}"`)
}
/** Every "Building:" / "Dự án:" fact line in a description, checked by projectValueProblem. */
export function projectLineProblems(description: string | null): string[] {
  return [...(description ?? '').matchAll(/^(?:Building|Dự án): (.*)$/gm)].map((m) => projectValueProblem(m[1])).filter((p): p is string => p !== null)
}
/** An alley/door word glued to a number — in any stored text, accent-folded searchText included. */
export const ALLEY_NUMBER = /(?:^|[^\p{L}\p{M}])(?:hẻm|hem|kiệt|kiet|ngõ|ngo|ngách|ngach|số nhà|so nha|sn|k)\s*\d/iu
/** A door or alley number in composed text that never carries a street (title, titleVi, location):
 *  the alley pattern, or a '506/35'-style number. (Not searchText: it carries the street, and a
 *  legitimate 'Đường 3/2' folds to 'duong 3/2' there.) */
export const DOOR_IN_TEXT = new RegExp(`\\d+\\s*\\/\\s*\\d+|${ALLEY_NUMBER.source}`, 'iu')

/** Our own intro paragraph names a domain; the screen runs on everything after it. */
const facts = (d: string | null, intro: string) => (d ?? '').startsWith(intro) ? (d ?? '').slice(intro.length) : (d ?? '')
const dirty = (t: string | null) => !!t && (containsPhoneNumber(t) || containsContactInfo(t) || findBannedWord(t) !== null)

/** The per-row checks, over one ACTIVE row as stored. Pure, so the unit test runs them on made rows. */
export const ROW_CHECKS = [
  'offHost', 'badImages', 'fewPhotos', 'hotlinks', 'badPins', 'unranked', 'badUnit', 'badCity', 'badDistrict',
  'doorNumber', 'contact', 'futurePost', 'importTimePost',
] as const
export type RowCheck = (typeof ROW_CHECKS)[number]
export type VerifyRow = {
  affiliateUrl: string | null; images: string; lat: number | null; lng: number | null; rankScore: number
  city: string; district: string | null; priceUnit: string | null; title: string; titleVi: string | null
  location: string; description: string; descriptionVi: string | null; searchText: string | null
  postedAt: Date; createdAt: Date
}
/** `unranked` and `importTimePost` are reported, never failures (see main). */
export function checkRow(r: VerifyRow, minPhotos: number): { failed: RowCheck[]; door: string | null } {
  const failed: RowCheck[] = []
  if (!isNhatotAffiliateUrl(r.affiliateUrl)) failed.push('offHost')
  let imgs: unknown = null
  try { imgs = JSON.parse(r.images) } catch { imgs = null }
  if (!Array.isArray(imgs) || imgs.length === 0 || !imgs.every((u) => typeof u === 'string' && isOverlayImageUrl(u))) failed.push('badImages')
  /** The publish gate's own measure: distinct angles by the dHash in each stored URL. */
  else if (countDistinctAngles(imgs as string[]) < minPhotos) failed.push('fewPhotos')
  if (r.images.includes('cdn.chotot.com')) failed.push('hotlinks')
  const pinOk = (r.lat === null && r.lng === null)
    || (r.lat !== null && r.lng !== null && r.lat >= 8 && r.lat <= 24 && r.lng >= 102 && r.lng <= 110 && !(r.lat === 0 && r.lng === 0))
  if (!pinOk) failed.push('badPins')
  if (!(r.rankScore > 0)) failed.push('unranked')
  /** 'VND' drops the "/ month" suffix on every card (taxonomy.ts: rent → 'VND/month'). */
  if (r.priceUnit !== NHATOT_PRICE_UNIT) failed.push('badUnit')
  /** One spelling per city: the vn-units name, which the wizard and the older rows use too. */
  if (!CITY_OK.has(r.city)) failed.push('badCity')
  if (r.district && /^thành phố\s/i.test(r.district)) failed.push('badDistrict')
  const door = [
    ...streetLineProblems(r.description), ...streetLineProblems(r.descriptionVi),
    ...projectLineProblems(r.description), ...projectLineProblems(r.descriptionVi),
    ...slashDoorLineProblems(r.description), ...slashDoorLineProblems(r.descriptionVi),
    ...[r.title, r.titleVi, r.location].filter((t) => t && DOOR_IN_TEXT.test(t)).map((t) => `door pattern in "${t!.slice(0, 80)}"`),
    ...(r.searchText && ALLEY_NUMBER.test(r.searchText) ? [`alley number in searchText "${r.searchText.slice(0, 80)}"`] : []),
  ][0] ?? null
  if (door) failed.push('doorNumber')
  if ([r.title, r.titleVi, r.location, facts(r.description, NHATOT_INTRO_EN), facts(r.descriptionVi, NHATOT_INTRO_VI)].some(dirty)) failed.push('contact')
  /** postedAt is the SOURCE's date, clamped to the import time — never later than the row itself. */
  if (r.postedAt.getTime() > r.createdAt.getTime() + 60_000) failed.push('futurePost')
  if (Math.abs(r.postedAt.getTime() - r.createdAt.getTime()) < 1_000) failed.push('importTimePost')
  return { failed, door }
}

async function main() {
  const { PrismaClient } = await import('../src/generated/prisma/client')
  const { PrismaPg } = await import('@prisma/adapter-pg')
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
  /** Read-only at the database, whatever the caller's environment says. */
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString, options: '-c default_transaction_read_only=on' }),
    log: ['warn', 'error'],
  })

  const where = { sellerId: NHATOT_SELLER_ID }
  const total = await db.listing.count({ where })
  const active = await db.listing.count({ where: { ...where, status: 'active' } })
  console.log(`  nhatot rows           ${total}  (active ${active}, hidden/other ${total - active})`)

  /** ⛔ Zero rows would pass every count below — assert the subject exists first. */
  const sellerRow = await db.seller.findUnique({ where: { id: NHATOT_SELLER_ID }, select: { name: true } })
  let vacuous: string | null = null
  if (!sellerRow) vacuous = `seller ${NHATOT_SELLER_ID} does not exist`
  else if (sellerRow.name !== NHATOT_SELLER_NAME) vacuous = `seller ${NHATOT_SELLER_ID} is named "${sellerRow.name}", not "${NHATOT_SELLER_NAME}"`
  else if (total === 0) vacuous = `seller ${NHATOT_SELLER_ID} has no listings — nothing to verify`
  /** Every row check below reads ACTIVE rows: none active would print "0 ok" on all of them. */
  else if (active === 0) vacuous = `seller ${NHATOT_SELLER_ID} has ${total} listings and none active — nothing to verify`
  if (vacuous) {
    console.error(`  PRECONDITION FAILED: ${vacuous}`)
    await db.$disconnect()
    process.exitCode = 1
    return
  }

  const noAffiliate = await db.listing.count({ where: { ...where, affiliateUrl: null } })
  const negotiable = await db.listing.count({ where: { ...where, negotiable: true } })
  const notRent = await db.listing.count({ where: { ...where, listingType: { not: 'rent' } } })
  /** `verified` is the PUBLICATION GATE: a supermajority held is the "0 listings" outage. */
  const held = await db.listing.count({ where: { ...where, status: 'active', verified: false } })
  const allHeld = active > 0 && held >= active * 0.9
  const sellerBadged = await db.seller.count({ where: { id: NHATOT_SELLER_ID, OR: [{ verified: true }, { verifiedSeller: true }, { officialPartner: true }] } })
  const owned = await db.seller.count({ where: { id: NHATOT_SELLER_ID, ownerId: { not: null } } })

  /** Row-level checks that need the values, over ACTIVE rows (what the public sees). */
  const rows = await db.listing.findMany({
    where: { ...where, status: 'active' },
    select: {
      id: true, affiliateUrl: true, images: true, lat: true, lng: true, rankScore: true, city: true, district: true,
      priceUnit: true, title: true, titleVi: true, location: true, description: true, descriptionVi: true,
      searchText: true, postedAt: true, createdAt: true,
    },
  })
  const minPhotos = minPhotosFor(NHATOT_CATEGORY_SLUG)
  const tally = Object.fromEntries(ROW_CHECKS.map((k) => [k, 0])) as Record<RowCheck, number>
  const doorSamples: string[] = []
  for (const r of rows) {
    const c = checkRow(r, minPhotos)
    for (const k of c.failed) tally[k]++
    if (c.door && doorSamples.length < 5) doorSamples.push(`${r.id}: ${c.door}`)
  }
  const { offHost, badImages, fewPhotos, hotlinks, badPins, unranked, badUnit, badCity, badDistrict, doorNumber, contact, futurePost, importTimePost } = tally
  const dupes = await db.listing.groupBy({
    by: ['externalId'], where, _count: { externalId: true },
    having: { externalId: { _count: { gt: 1 } } },
  })

  const line = (label: string, n: number, failMsg = 'FAIL') => console.log(`  ${label.padEnd(22)}${n}   ${n ? failMsg : 'ok'}`)
  line('missing affiliateUrl', noAffiliate)
  line('affiliateUrl off-host', offHost)
  line('negotiable=true', negotiable)
  line('listingType != rent', notRent)
  console.log(`  ${'held (verified=false)'.padEnd(22)}${held}   ${allHeld ? 'FAIL — ALL rows held, category renders empty' : held ? '(moderator holds — not a failure)' : 'ok'}`)
  line('seller badged', sellerBadged, 'FAIL — implies we vetted them')
  line('seller has an owner', owned, 'FAIL — a real person receives these enquiries')
  line('images not ours/empty', badImages, 'FAIL — not a clean affiliate/m/ overlay copy')
  line(`< ${minPhotos} distinct photos`, fewPhotos, `FAIL — under the ${NHATOT_CATEGORY_SLUG} publish floor`)
  line('cdn.chotot hotlinks', hotlinks)
  line('pin outside Vietnam', badPins)
  line(`priceUnit != ${NHATOT_PRICE_UNIT}`, badUnit, 'FAIL — cards lose the "/ month" suffix')
  line('city not vn-units name', badCity, `FAIL — store ${[...CITY_OK].join(' / ')} (one spelling per city)`)
  line("district 'Thành phố …'", badDistrict, "FAIL — store 'TP. …' like the rest of the catalogue")
  line('door/alley number', doorNumber, 'FAIL — a house or alley number is published')
  for (const s of doorSamples) console.log(`      ${s}`)
  line('contact in text', contact, 'FAIL — phone / link / handle / banned word in stored text')
  line('postedAt in future', futurePost, 'FAIL — a source date after the row was created')
  console.log(`  ${'postedAt = import time'.padEnd(22)}${importTimePost}   ${importTimePost ? '(the source date should be earlier than the import — check list_time was used)' : 'ok'}`)
  line('duplicate externalIds', dupes.length)
  console.log(`  ${'rankScore = 0'.padEnd(22)}${unranked}   ${unranked ? '(dead last until the nightly recompute — not a failure)' : 'ok'}`)
  const byCity = rows.reduce<Record<string, number>>((a, r) => { a[r.city] = (a[r.city] ?? 0) + 1; return a }, {})
  console.log(`  active by city        ${JSON.stringify(byCity)}`)

  await db.$disconnect()
  const failures = noAffiliate + offHost + negotiable + notRent + (allHeld ? held : 0) + sellerBadged + owned
    + badImages + fewPhotos + hotlinks + badPins + badUnit + badCity + badDistrict + doorNumber + contact + futurePost + dupes.length
  if (failures) {
    console.error(`\n  ${failures} INVARIANT FAILURE(S) — exiting non-zero`)
    process.exitCode = 1
  }
}

/** Run only when executed — the checks above are imported by the unit test (nhatot-listing.test.ts). */
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
