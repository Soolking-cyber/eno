/**
 * Vietnam's mobile carriers as partner storefronts, with their eSIM and their plans as listings under
 * Services › eSIM. Every listing links OUT to the carrier's own page; eno.vn sells nothing here.
 *
 *   npx tsx scripts/import-esim.ts                        # DRY RUN — validates, fetches every image, writes nothing
 *   npx tsx scripts/import-esim.ts --carrier viettel      # one carrier
 *   npx tsx scripts/import-esim.ts --apply                # performs the writes
 *   npx tsx scripts/import-esim.ts --apply --reimage      # also re-host photos of listings that already have them
 *   npx tsx scripts/import-esim.ts --asset-dir <dir>      # local copies for images a script cannot fetch (see fetchImage)
 *
 * Data: data/esim-carriers.json — every price, allowance and link was read off the carrier's OFFICIAL
 * site on `checkedOn` and re-checked by a second, independent pass (`sourceUrl` on every offer and
 * plan is the page the figure was read from). Tariffs go stale, so a price refresh is: edit that
 * file, re-run.
 * Each description says the date it was checked, and the plan's page is one tap away.
 *
 * Logos are NOT set here — that is scripts/set-partner-avatar.ts, one carrier at a time, which
 * refuses a mark that is invisible on white. This script prints the exact commands at the end.
 *
 * ⛔ A CARRIER STOREFRONT WITH AN OWNER IS REFUSED, and so is an ambiguous name. `Seller.name` is not
 * unique and is user-settable, so "Viettel" could be somebody's shop; hanging 7 listings and a partner
 * badge off it would hand them a carrier's catalogue. Same rule as seed-vinwonders / import-partners.
 *
 * ⛔ IDEMPOTENT ON (sellerId, externalId) — `esim:<carrier>:<offer>` / `plan:<carrier>:<CODE>` — so a
 * re-run refreshes prices and copy instead of multiplying the catalogue, and a renamed title is not a
 * new listing. `status`, `verified` and `rankScore` are CREATE-ONLY: a moderator's hide survives a
 * refresh, and rankScore is only right at age 0 (the daily re-decay owns it after that).
 *
 * ⚠️ A PLAN THAT DISAPPEARS FROM THE FILE IS REPORTED, NOT RETIRED. Hiding it is a one-line SQL the
 * report prints; doing it automatically would let a truncated data file wipe a carrier.
 */
import 'dotenv/config'
import { readFileSync, readdirSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { db } from '../src/lib/db'
import { makeImageHost } from '../src/lib/host-product-image'
import { buildSearchText } from '../src/lib/fold'
import { browseRankScore } from '../src/lib/ranking-formula'
import { findBannedWord } from '../src/lib/publish-guard'
import { containsPhoneNumber } from '../src/lib/phone'
import { facetsFor } from '../src/lib/taxonomy'

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
const APPLY = process.argv.includes('--apply')
const REIMAGE = process.argv.includes('--reimage')
const ONLY = arg('carrier')
const ASSET_DIR = arg('asset-dir')
const VERBOSE = process.argv.includes('--verbose')   // print every rendered title + description

const CATEGORY_SLUG = 'services'
const SUBCATEGORY = 'esim'
/**
 * The eSIM aisle's own facets. Every attribute this script writes must be one of their OPTION values:
 * the feed filters by an exact `"key":"value"` substring, so a value the taxonomy does not offer is a
 * listing no chip can ever find — the data file and the taxonomy are checked against each other here.
 */
const ESIM_FACETS = new Map(facetsFor(CATEGORY_SLUG, SUBCATEGORY).map((f) => [f.key, new Set((f.options ?? []).map((o) => o.value))]))
/** EXACT facet values, never buckets: 30 → "30-days", 1.5 → "1-5gb". A figure the taxonomy has no
 *  option for fails badFacetValues and the row is blocked — never rounded into a neighbouring chip. */
const validityValue = (d: number) => (d === 1 ? '1-day' : `${d}-days`)
const dailyValue = (gb: number) => `${String(gb).replace('.', '-')}gb`
function badFacetValues(attrs: Record<string, string>): string[] {
  return Object.entries(attrs).filter(([k, v]) => !ESIM_FACETS.get(k)?.has(v)).map(([k, v]) => `${k}="${v}"`)
}
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'

type Offer = {
  id: string; titleEn: string; titleVi: string; priceVnd: number; saleUrl: string; imageUrl: string
  feeNoteEn: string; feeNoteVi: string; whoCanBuyEn: string; whoCanBuyVi: string
  howToEn: string[]; howToVi: string[]; includesEn: string | null; includesVi: string | null
  sourceUrl: string
  /** Overrides the carrier's `foreigners` for this offer (MobiFone's Travel eSIM is passport-online). */
  foreigners?: string
}
type Plan = {
  code: string; kind: 'data' | 'combo'; priceVnd: number; validityDays: number
  /** daily = an allowance per day; pool = one total for the cycle; unlimited = never cut off (the
   *  high-speed part, if any, is `dataPerDayGB`). Stored, not parsed from the display strings. */
  dataStyle: 'daily' | 'pool' | 'unlimited'; dataPerDayGB: number | null
  /** Overrides the carrier's `foreigners`: MobiFone's FR10/FR30 are the Travel eSIM's own top-ups,
   *  bought online by the passport holder who got that eSIM online. */
  foreigners?: string
  dataShortEn: string; dataShortVi: string; dataLongEn: string; dataLongVi: string
  callsEn: string | null; callsVi: string | null; renewalEn: string | null; renewalVi: string | null
  registerEn: string | null; registerVi: string | null; restrictionsEn: string | null; restrictionsVi: string | null
  url: string; imageUrl: string | null; sourceUrl: string
}
type Carrier = {
  key: string
  /** The `carrier` facet value (taxonomy.ts). */
  slug: string
  /** The `foreigners` facet value: how a passport holder gets this carrier's eSIM. */
  foreigners: string
  sellerName: string; legalName: string; website: string
  /** Hostnames a listing may link to (the carrier's own, or its own retail arm) — exact or subdomain. */
  domains: string[]
  /** EXACT extra hosts the carrier serves its own images from (its CDN / object storage). Images may
   *  come from `domains` or these; links may not. */
  assetDomains: string[]
  networkKind: 'MNO' | 'MVNO' | 'brand'; networkHost: string
  networkNoteEn: string; networkNoteVi: string; brandColor: string; logoUrl: string; bioEn: string
  /** The carrier's own eSIM image for plans with no art of their own, when there is no priced eSIM
   *  offer to borrow it from (Vietnamobile publishes no new-eSIM price, so it has no eSIM listing). */
  imageUrl?: string
  esimOffers: Offer[]; plans: Plan[]
}
type DataFile = { checkedOn: string; carriers: Carrier[] }

const data: DataFile = JSON.parse(readFileSync(new URL('../data/esim-carriers.json', import.meta.url), 'utf8'))
const carriers = data.carriers.filter((c) => !ONLY || c.key === ONLY)
if (ONLY && !carriers.length) { console.error(`no carrier "${ONLY}" in data/esim-carriers.json`); process.exit(1) }

// ── copy ────────────────────────────────────────────────────────────────────────────────────────
// ⚠️ "eno", NEVER "eno.vn", in anything a buyer reads: both editions share one database, so these
// rows render on eno.forum too (the partner bios already say "eno introduces GMBR").
const checked = new Date(`${data.checkedOn}T00:00:00Z`)
if (Number.isNaN(checked.getTime())) { console.error(`checkedOn "${data.checkedOn}" is not a date`); process.exit(1) }
const checkedEn = checked.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const checkedVi = checked.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })
// House money format: full amount, comma-grouped + "VND" in English, dot-grouped + "đ" in Vietnamese.
const vndEn = (n: number) => `${n.toLocaleString('en-US')} VND`
const vndVi = (n: number) => `${n.toLocaleString('vi-VN')} đ`
const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`
const para = (...lines: (string | null | undefined | false)[]) => lines.filter(Boolean).join('\n')

function planTitle(c: Carrier, p: Plan) {
  return {
    en: `${c.sellerName} ${p.code} — ${p.dataShortEn}${p.kind === 'combo' ? ' + calls' : ''}, ${days(p.validityDays)}`,
    vi: `Gói ${p.code} ${c.sellerName} — ${p.dataShortVi}${p.kind === 'combo' ? ' + gọi' : ''}, ${p.validityDays} ngày`,
  }
}

function planDescription(c: Carrier, p: Plan) {
  const en = [
    para(`**${c.sellerName} ${p.code}** · ${vndEn(p.priceVnd)} for ${days(p.validityDays)}`,
      `- Data: ${p.dataLongEn}`,
      p.callsEn && `- Calls: ${p.callsEn}`,
      p.renewalEn && `- Renewal: ${p.renewalEn}`,
      p.registerEn && `- How to register: ${p.registerEn}`,
      p.restrictionsEn && `- Good to know: ${p.restrictionsEn}`,
      `- Network: ${c.networkNoteEn}`),
    `The plan is bought and activated with ${c.sellerName} — on its website, app or by SMS. eno does not sell SIMs or take payment for them.`,
    `Price and allowance as published by ${c.sellerName} on ${checkedEn}. Check the carrier's page before you buy.`,
  ].join('\n\n')
  const vi = [
    para(`**Gói ${p.code} ${c.sellerName}** · ${vndVi(p.priceVnd)} / ${p.validityDays} ngày`,
      `- Data: ${p.dataLongVi}`,
      p.callsVi && `- Gọi thoại: ${p.callsVi}`,
      p.renewalVi && `- Gia hạn: ${p.renewalVi}`,
      p.registerVi && `- Cách đăng ký: ${p.registerVi}`,
      p.restrictionsVi && `- Lưu ý: ${p.restrictionsVi}`,
      `- Hạ tầng mạng: ${c.networkNoteVi}`),
    `Gói cước được mua và kích hoạt trực tiếp với ${c.sellerName} — trên website, ứng dụng hoặc qua SMS. eno không bán SIM và không thu tiền gói cước.`,
    `Giá và ưu đãi theo công bố của ${c.sellerName} ngày ${checkedVi}. Vui lòng kiểm tra lại trên trang của nhà mạng trước khi mua.`,
  ].join('\n\n')
  return { en, vi }
}

function offerDescription(c: Carrier, o: Offer) {
  const steps = (xs: string[]) => xs.map((s, i) => `${i + 1}. ${s}`).join('\n')
  const en = [
    para(`**${o.titleEn}** · ${o.priceVnd === 0 ? 'free' : vndEn(o.priceVnd)}`, o.feeNoteEn, o.includesEn && `Includes: ${o.includesEn}`),
    `**Who can buy:** ${o.whoCanBuyEn}`,
    `**How to get it:**\n${steps(o.howToEn)}`,
    `**Network:** ${c.networkNoteEn}. ${c.sellerName}'s data and call plans are listed on its storefront on eno.`,
    `You buy the eSIM from ${c.sellerName} directly; eno does not sell SIMs or take payment for them. Price as published by ${c.sellerName} on ${checkedEn}.`,
  ].join('\n\n')
  const vi = [
    para(`**${o.titleVi}** · ${o.priceVnd === 0 ? 'miễn phí' : vndVi(o.priceVnd)}`, o.feeNoteVi, o.includesVi && `Bao gồm: ${o.includesVi}`),
    `**Ai có thể mua:** ${o.whoCanBuyVi}`,
    `**Cách nhận eSIM:**\n${steps(o.howToVi)}`,
    `**Hạ tầng mạng:** ${c.networkNoteVi}. Các gói data và gói thoại của ${c.sellerName} có trên gian hàng của nhà mạng trên eno.`,
    `Bạn mua eSIM trực tiếp từ ${c.sellerName}; eno không bán SIM và không thu tiền. Giá theo công bố của ${c.sellerName} ngày ${checkedVi}.`,
  ].join('\n\n')
  return { en, vi }
}

// ── validation — a broken listing is reported, never rendered ──────────────────────────────────
const httpsHost = (url: string) => { try { const u = new URL(url); return u.protocol === 'https:' ? u.hostname.toLowerCase() : null } catch { return null } }
const onDomains = (h: string, domains: string[]) => domains.some((d) => h === d || h.endsWith(`.${d}`))
/** A LINK must be on the carrier's own domains. */
const hostOk = (url: string, c: Carrier) => { const h = httpsHost(url); return !!h && onDomains(h, c.domains) }
/** An IMAGE may also come from the carrier's own CDN hosts — never from anywhere else. */
const imageHostOk = (url: string, c: Carrier) => { const h = httpsHost(url); return !!h && (onDomains(h, c.domains) || c.assetDomains.includes(h)) }
const externalCode = (code: string) =>
  code.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '')

/**
 * The publish gate's TEXT screens, run on this script's own copy — a direct write skips the POST path
 * that would run them. Banned words (illegal goods) and PHONE NUMBERS: carrier hotlines are public,
 * but eno shows no phone number on a listing and a partner shares none (phoneForSeller), so the data
 * file names "the carrier's hotline" instead. The link/URL screen is NOT run: naming the carrier's
 * own site ("mobifone.vn/travel") is the point of these listings, and the outbound link is already
 * restricted to the carrier's domains.
 */
function screenCopy(texts: string[]): string | null {
  for (const t of texts) {
    const banned = findBannedWord(t)
    if (banned) return `banned phrase "${banned}"`
    if (containsPhoneNumber(t)) return `phone number in "${t.slice(0, 60)}…"`
  }
  return null
}

type Row = {
  carrier: Carrier; externalId: string; kind: 'esim' | 'data' | 'combo'; label: string
  /** The eSIM facet values for this listing, already checked against the taxonomy. */
  attrs: Record<string, string>
  titleEn: string; titleVi: string; descEn: string; descVi: string; price: number; url: string; image: string; code: string
}

function rowsFor(c: Carrier): { rows: Row[]; problems: string[]; planned: string[] } {
  const problems: string[] = []
  /** Every externalId the data file names for this carrier, blocked or not — see the stale report. */
  const planned: string[] = []
  if (!/^#[0-9a-f]{6}$/i.test(c.brandColor) || /^#f{6}$/i.test(c.brandColor)) problems.push(`brandColor "${c.brandColor}"`)
  if (!c.bioEn.includes(`eno introduces ${c.sellerName}`)) problems.push('bioEn lacks the intermediary sentence')
  // A shape check on the data, not a block: every well-formed plan is still imported.
  if (c.plans.filter((p) => p.kind === 'data').length !== 3 || c.plans.filter((p) => p.kind === 'combo').length !== 3) {
    console.log(`    ⚠️ ${c.sellerName}: expected 3 data + 3 combo plans, got ${c.plans.map((p) => p.kind).join(',')}`)
  }
  const esimImage = c.imageUrl ?? c.esimOffers.find((o) => o.id === 'esim')?.imageUrl ?? c.esimOffers[0]?.imageUrl
  if (esimImage && !imageHostOk(esimImage, c)) problems.push(`fallback image host ${esimImage}`)
  const rows: Row[] = []
  const offerIds = new Set<string>()
  for (const o of c.esimOffers) {
    planned.push(`esim:${c.key}:${o.id}`)
    const bad = [
      !/^[a-z0-9-]+$/.test(o.id) && `id "${o.id}"`,
      offerIds.has(o.id) && 'duplicate offer id',
      // 0 is allowed ONLY here, and renders "Free": MobiFone's Travel eSIM genuinely costs nothing.
      !(Number.isFinite(o.priceVnd) && o.priceVnd >= 0) && `price ${o.priceVnd}`,
      !hostOk(o.saleUrl, c) && `saleUrl ${o.saleUrl}`,
      !(o.imageUrl && imageHostOk(o.imageUrl, c)) && `image ${o.imageUrl}`,
    ].filter(Boolean)
    offerIds.add(o.id)
    const attrs = { planType: 'esim', network: c.networkHost, carrier: c.slug, foreigners: o.foreigners ?? c.foreigners }
    bad.push(...badFacetValues(attrs).map((x) => `not a taxonomy option: ${x}`))
    if (bad.length) { problems.push(`${o.id}: ${bad.join(', ')}`); continue }
    const d = offerDescription(c, o)
    const screen = screenCopy([o.titleEn, o.titleVi, d.en, d.vi])
    if (screen) { problems.push(`${o.id}: ${screen}`); continue }
    rows.push({ carrier: c, externalId: `esim:${c.key}:${o.id}`, kind: 'esim', label: o.id, code: o.id, attrs,
      titleEn: o.titleEn, titleVi: o.titleVi, descEn: d.en, descVi: d.vi, price: o.priceVnd, url: o.saleUrl, image: o.imageUrl })
  }
  const seen = new Set<string>()
  for (const p of c.plans) {
    const code = externalCode(p.code)
    if (code) planned.push(`plan:${c.key}:${code}`)
    const image = p.imageUrl || esimImage
    const t = planTitle(c, p)
    const bad = [
      // ⛔ 0 renders as "Free / Miễn phí" in 3xl bold (price.tsx); a paid plan must never read free.
      !(Number.isFinite(p.priceVnd) && p.priceVnd >= 1000) && `price ${p.priceVnd}`,
      !(Number.isInteger(p.validityDays) && p.validityDays > 0) && `validity ${p.validityDays}`,
      !hostOk(p.url, c) && `url ${p.url}`,
      !(image && imageHostOk(image, c)) && `image ${image}`,
      !code && 'code',
      seen.has(code) && 'duplicate code',
      (t.en.length > 140 || t.vi.length > 140) && 'title over 140 chars',
    ].filter(Boolean)
    seen.add(code)
    const attrs: Record<string, string> = {
      planType: p.kind, network: c.networkHost, carrier: c.slug, foreigners: p.foreigners ?? c.foreigners,
      validity: validityValue(p.validityDays), dataStyle: p.dataStyle,
      // Only when there IS a per-day figure: a pool plan has no "GB per day".
      ...(typeof p.dataPerDayGB === 'number' && p.dataPerDayGB > 0 ? { dailyData: dailyValue(p.dataPerDayGB) } : {}),
    }
    if (p.dataStyle === 'daily' && !(typeof p.dataPerDayGB === 'number' && p.dataPerDayGB > 0)) bad.push('daily plan without dataPerDayGB')
    bad.push(...badFacetValues(attrs).map((x) => `not a taxonomy option: ${x}`))
    if (bad.length) { problems.push(`${p.code}: ${bad.join(', ')}`); continue }
    const d = planDescription(c, p)
    const screen = screenCopy([t.en, t.vi, d.en, d.vi])
    if (screen) { problems.push(`${p.code}: ${screen}`); continue }
    rows.push({ carrier: c, externalId: `plan:${c.key}:${code}`, kind: p.kind, label: p.code, code: p.code, attrs,
      titleEn: t.en, titleVi: t.vi, descEn: d.en, descVi: d.vi, price: p.priceVnd, url: p.url, image: image! })
  }
  return { rows, problems, planned }
}

// ── images: hosted CLEAN under affiliate/m/ for the app-drawn eno.vn mark, once per source URL ──
/**
 * Three ways to get the bytes, tried in order, because carrier CDNs are hostile to scripts:
 *  1. fetch with a browser UA (several refuse a bare fetch);
 *  2. curl — ⚠️ esim.vnpt.vn serves an INCOMPLETE certificate chain: Node's fetch refuses it
 *     ("fetch failed") while curl, on the system trust store, completes and still verifies it;
 *  3. `--asset-dir`: a local copy named `<first 16 hex of sha1(url)>.<ext>` — for vnsky.vn, whose
 *     bot wall answers every non-browser client 403. The copy must be the carrier's own file,
 *     downloaded by a browser from that same URL; the stored listing still records nothing but it.
 */
const assetKey = (url: string) => createHash('sha1').update(url).digest('hex').slice(0, 16)
const localAssets = (() => {
  if (!ASSET_DIR) return new Map<string, string>()
  return new Map(readdirSync(ASSET_DIR).map((f) => [f.split('.')[0], join(ASSET_DIR, f)] as const))
})()
const isImage = (b: Buffer) => b.length > 1024 && (
  b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) || // png
  (b[0] === 0xff && b[1] === 0xd8) ||                                                          // jpeg
  (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') ||       // webp
  b.subarray(0, 6).toString() === 'GIF89a' || b.subarray(4, 12).toString().startsWith('ftypavi'))
async function fetchImage(url: string, referer: string): Promise<{ buf: Buffer; via: string } | null> {
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, referer, accept: 'image/avif,image/webp,image/*,*/*;q=0.8' }, signal: AbortSignal.timeout(30_000) })
    const buf = res.ok ? Buffer.from(await res.arrayBuffer()) : null
    if (buf && isImage(buf)) return { buf, via: 'fetch' }
  } catch { /* fall through to curl */ }
  // https only, including every redirect hop — the URL comes from a data file, and curl would
  // otherwise also speak file:// and a dozen other protocols. (Only an https:// URL reaches here, so
  // it cannot begin with "-" and be read as an option.)
  const viaCurl = !url.startsWith('https://') ? null : await new Promise<Buffer | null>((resolve) => {
    execFile('curl', ['-sSfL', '--proto', '=https', '--proto-redir', '=https', '--max-time', '60', '-A', UA, '-e', referer, url],
      { encoding: 'buffer', maxBuffer: 64 << 20 }, (err, out) => resolve(err ? null : out))
  })
  if (viaCurl && isImage(viaCurl)) return { buf: viaCurl, via: 'curl' }
  const local = localAssets.get(assetKey(url))
  if (local) {
    const buf = readFileSync(local)
    if (isImage(buf)) return { buf, via: `asset-dir ${local}` }
  }
  return null
}

async function main() {
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${carriers.length} carrier(s), prices checked ${data.checkedOn}\n`)

  const category = await db.category.findUnique({ where: { slug: CATEGORY_SLUG }, select: { id: true, name: true, nameVi: true } })
  if (!category) { console.error(`category "${CATEGORY_SLUG}" not found — refusing to guess`); process.exit(1) }

  const storageUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '')
  const secret = process.env.SUPABASE_SECRET_KEY
  if (APPLY && (!storageUrl || !secret)) { console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY required'); process.exit(1) }
  if (APPLY && /supabase\.co$/.test(new URL(storageUrl!).hostname)) { console.error(`Refusing to upload to ${storageUrl} — retired project`); process.exit(1) }
  const storage = APPLY ? createClient(storageUrl!, secret!, { auth: { persistSession: false } }).storage.from('listings') : null
  const host = makeImageHost({ storage, storageUrl: storageUrl ?? '', bucket: 'listings', edge: 1200, quality: 80, mark: 'overlay' })

  const all: Row[] = []
  const plannedFor = new Map<Carrier, string[]>()
  let blocked = 0
  for (const c of carriers) {
    const { rows, problems, planned } = rowsFor(c)
    plannedFor.set(c, planned)
    console.log(`${c.sellerName.padEnd(14)} ${rows.length} listing(s)${problems.length ? `  ⛔ ${problems.length} blocked` : ''}`)
    for (const p of problems) console.log(`    ⛔ ${p}`)
    blocked += problems.length
    all.push(...rows)
  }

  // Every image is fetched in the dry run too, so an unreachable one is found before anything is written.
  const bytes = new Map<string, Buffer | null>()
  for (const r of all) {
    if (bytes.has(r.image)) continue
    const got = await fetchImage(r.image, r.carrier.website)
    bytes.set(r.image, got?.buf ?? null)
    if (got && got.via !== 'fetch') console.log(`    image via ${got.via}: ${r.image}`)
  }
  const deadImages = [...bytes].filter(([, b]) => !b).map(([u]) => u)
  for (const u of deadImages) console.log(`    ⛔ image unreachable: ${u}  (asset-dir name: ${assetKey(u)}.<ext>)`)
  const ready = all.filter((r) => bytes.get(r.image))
  console.log(`\n${ready.length} ready · ${blocked} blocked by data · ${all.length - ready.length} blocked by an unreachable image`)
  for (const r of ready) {
    console.log(`  ${r.externalId.padEnd(34)} ${String(r.price.toLocaleString('en-US')).padStart(8)}  ${r.titleEn}`)
    if (VERBOSE) console.log(`\n    ${r.titleVi}\n    → ${r.url}\n    🖼 ${r.image}\n\n${r.descEn}\n\n${r.descVi}\n${'─'.repeat(100)}`)
  }

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply.')
    await db.$disconnect()
    return
  }

  let created = 0, updated = 0, imaged = 0
  const hosted = new Map<string, string | null>()
  const avatarCommands: string[] = []
  const touchedSellers: string[] = []
  for (const c of carriers) {
    const rows = ready.filter((r) => r.carrier === c)
    if (!rows.length) {
      console.log(`\n⚠️ ${c.sellerName}: nothing ready — storefront not touched. Anything a previous run imported for it stays LIVE at its previous prices until the data is fixed.`)
      continue
    }

    // ── storefront ──
    /**
     * ⛔ PINNED BY ITS LISTINGS FIRST, BY NAME ONLY ON THE FIRST RUN. A name is user-settable and not
     * unique: a storefront an admin renamed would otherwise be missed and a SECOND one created with a
     * second catalogue. The storefront a previous run created is the one carrying this carrier's
     * `esim:<key>:` / `plan:<key>:` rows.
     */
    const pinned = await db.listing.findFirst({
      where: { OR: [{ externalId: { startsWith: `esim:${c.key}:` } }, { externalId: { startsWith: `plan:${c.key}:` } }] },
      select: { sellerId: true },
    })
    const same = pinned
      ? await db.seller.findMany({ where: { id: pinned.sellerId }, select: { id: true, name: true, ownerId: true, phone: true, trustScore: true, avatarUrl: true, bio: true } })
      : await db.seller.findMany({ where: { name: c.sellerName }, select: { id: true, name: true, ownerId: true, phone: true, trustScore: true, avatarUrl: true, bio: true } })
    if (same.some((s) => s.ownerId)) { console.error(`\n⛔ "${c.sellerName}" is owned by a real account — skipping this carrier`); continue }
    if (same.length > 1) { console.error(`\n⛔ ${same.length} storefronts are named "${c.sellerName}" — refusing to guess`); continue }
    /**
     * ⛔ OWNERLESS IS NOT ENOUGH: a GUEST's shop is ownerless too (identified by `phone` until it is
     * claimed), and "Local" is exactly the kind of name one could pick. So an existing storefront is
     * adopted only when it has no phone and carries nothing but this importer's own listings — i.e.
     * it is the one a previous run created.
     */
    if (same[0]) {
      // ⚠️ `externalId: null` explicitly: SQL `NOT (NULL LIKE 'esim:%')` is NULL, so a hand-posted
      // listing (no externalId) would otherwise slip past the NOT and never be counted.
      const foreign = await db.listing.count({ where: { sellerId: same[0].id, OR: [
        { externalId: null },
        { AND: [{ NOT: { externalId: { startsWith: 'esim:' } } }, { NOT: { externalId: { startsWith: 'plan:' } } }] },
      ] } })
      if (same[0].phone || foreign) { console.error(`\n⛔ "${same[0].name}" (${same[0].id}) is somebody else's storefront (${same[0].phone ? 'guest phone' : `${foreign} other listing(s)`}) — skipping this carrier`); continue }
      if (same[0].name !== c.sellerName) console.log(`  ℹ️ storefront was renamed to "${same[0].name}" — kept`)
      if (same[0].bio !== c.bioEn) console.log(`  ℹ️ ${same[0].name}: stored bio differs from the data file — left as it is`)
    }
    /**
     * ⛔ STOREFRONT FIELDS ARE CREATE-ONLY. `officialPartner` especially: re-asserting it on every run
     * would silently undo `set-official-partner.mjs --off`. The owner granted it for these carriers
     * (2026-09-25: "add them as partner"), the same grant import-partners.ts makes for the fetched
     * shops; `verified` stays false — that is an identity check on the business nobody has performed.
     * ⚠️ rating/reviewCount start at 0: the schema defaults (5 stars) would print a fabricated rating.
     */
    const seller = same[0] ?? await db.seller.create({
      data: { name: c.sellerName, bio: c.bioEn, location: 'Việt Nam', avatarColor: c.brandColor, officialPartner: true, verified: false, rating: 0, reviewCount: 0 },
      select: { id: true, name: true, ownerId: true, phone: true, trustScore: true, avatarUrl: true, bio: true },
    })
    if (!seller.avatarUrl) avatarCommands.push(`npx tsx scripts/set-partner-avatar.ts --seller ${JSON.stringify(seller.name)} --logo ${JSON.stringify(c.logoUrl)} --apply`)

    // Filled only AFTER a row's upsert succeeds: a row skipped on a failed upload is still live at its
    // old price, and the report below must say so (a reviewer's catch).
    const written = new Set<string>()
    for (const r of rows) {
      const existing = await db.listing.findFirst({ where: { sellerId: seller.id, externalId: r.externalId }, select: { id: true, images: true } })
      let images = existing?.images
      if (!existing || REIMAGE || !images || images === '[]') {
        if (!hosted.has(r.image)) hosted.set(r.image, await host.fromBuffer(bytes.get(r.image)!, `esim-${c.key}`))
        const url = hosted.get(r.image)
        if (!url) { console.error(`  ⛔ ${r.externalId}: image upload failed — skipped`); continue }
        images = JSON.stringify([url]); imaged++
      }
      // `serviceLocation` is not a chip INSIDE eSIM (taxonomy excludes it there), but the Services-wide
      // "Online" filter still reads it, and these belong under it. `providerType` is derived for
      // posted listings (createListingCore) and must be written by hand here, or "Business" misses them.
      const attributes = JSON.stringify({ serviceLocation: 'online', providerType: 'business', ...r.attrs })
      const fields = {
        title: r.titleEn, titleVi: r.titleVi, description: r.descEn, descriptionVi: r.descVi,
        // ⛔ The SYMBOL '₫', never 'VND' — anything else is treated as a foreign currency (import-accesstrade.ts).
        price: r.price, priceUnit: 'VND', currency: '₫', negotiable: false,
        // `new` so the PDP's Product JSON-LD does not fall back to UsedCondition for a null.
        condition: 'new', listingType: 'service', categoryId: category.id, subcategorySlug: SUBCATEGORY,
        brandSlug: null, model: null, attributes,
        // Exactly what the visa desk's online products store (seed-visa-shop.mjs): `city` is NOT NULL
        // and has no "nationwide" value, so a Hanoi city filter misses these — the known cost of the
        // precedent, not a claim that the carrier is in Saigon. No coordinates, so no false map pin.
        location: 'Online — nationwide', city: 'Ho Chi Minh City',
        images: images!, affiliateUrl: r.url, sellerTrustScore: seller.trustScore,
        searchText: buildSearchText([r.titleEn, r.titleVi, r.descEn, r.descVi, category.name, category.nameVi, c.sellerName, r.code, 'esim', 'sim', c.networkHost]),
      }
      await db.listing.upsert({
        where: { sellerId_externalId: { sellerId: seller.id, externalId: r.externalId } },
        update: fields,
        create: {
          ...fields, sellerId: seller.id, externalId: r.externalId, verified: true, status: 'active',
          rankScore: browseRankScore({ sellerTrustScore: seller.trustScore, postedAt: new Date(), featured: false }),
        },
      })
      written.add(r.externalId)
      if (existing) updated++; else created++
    }

    // Two different reports, never merged: a row the data file DROPPED may be hidden; a row that is
    // still in the file but was BLOCKED this run (bad data, dead image) is live at its LAST GOOD
    // price and must be fixed, not hidden.
    const planned = plannedFor.get(c) ?? []

    const live = await db.listing.findMany({
      where: { sellerId: seller.id, status: 'active', OR: [{ externalId: { startsWith: 'esim:' } }, { externalId: { startsWith: 'plan:' } }] },
      select: { id: true, externalId: true },
    })
    for (const l of live) {
      if (!planned.includes(l.externalId!)) console.log(`  ⚠️ ${c.sellerName}: ${l.externalId} is live but no longer in the data file — hide with: UPDATE "Listing" SET status='hidden' WHERE id='${l.id}';`)
      else if (!written.has(l.externalId!)) console.log(`  ⚠️ ${c.sellerName}: ${l.externalId} was BLOCKED this run and is still live at its previous price — fix its data`)
    }
    touchedSellers.push(seller.id)
    console.log(`\n${c.sellerName} (${seller.id}): ${rows.length} listing(s) written`)
  }

  console.log(`\nAPPLIED: ${created} created, ${updated} updated, ${imaged} image(s) hosted`)
  if (avatarCommands.length) {
    console.log('\nLogos (each refuses a mark that is invisible on white):')
    for (const cmd of avatarCommands) console.log(`  ${cmd}`)
  }
  if (touchedSellers.length) {
    console.log(`\nRollback (never DELETE — Order is onDelete:Restrict):\n  UPDATE "Listing" SET status='hidden' WHERE "sellerId" IN (${touchedSellers.map((id) => `'${id}'`).join(', ')});`)
  }
  await db.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
