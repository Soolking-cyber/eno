/**
 * Give every official-partner storefront its own logo, fetched from the partner's own site.
 *
 *   npx tsx scripts/fetch-partner-logos.ts                 # DRY RUN — what it found, per partner
 *   npx tsx scripts/fetch-partner-logos.ts --apply
 *   npx tsx scripts/fetch-partner-logos.ts --seller HShop --apply
 *
 * ⛔ THIS IS THE BULK SIBLING OF scripts/set-partner-avatar.ts, NOT A REPLACEMENT. That script
 * takes ONE seller and ONE `--logo <url>` a human already chose; 15 of the 20 partners had no
 * avatar and nobody was going to hand-pick 15 urls. What it adds is DISCOVERY — the guards below
 * are that script's, kept because each one is a scar.
 *
 * ⚠️ NO WATERMARK. src/lib/core/media.ts: the eno wordmark goes on LISTING photos, never on a shop
 * logo. Stamping ourselves across a partner's trademark would be the one place on the site where
 * we altered someone else's mark.
 *
 * ⚠️ THE SOURCE IS THE PARTNER'S OWN PUBLISHED ASSET — their og:image, apple-touch-icon or header
 * logo — never a screenshot or a redraw. We show it as their affiliate.
 *
 * ⛔ AND A MARK THAT IS INVISIBLE ON WHITE IS REFUSED, THEN THE NEXT CANDIDATE IS TRIED. A brand
 * publishes two logos: a colour one, and a WHITE one for dark headers. Both decode, both upload,
 * and flattening the white one onto white produces an empty circle — which is exactly what shipped
 * for CellphoneS (stored avatar 254,254,254, 3.7% non-white, storefront showed a blank ring, and
 * every signal said success: HTTP 200, valid webp, 512px). So visibility is measured on the OUTPUT,
 * because the output is the artefact people see, and a failing candidate falls through to the next
 * rather than failing the partner.
 *
 * ⚠️ A FAVICON IS A LAST RESORT AND OFTEN TOO SMALL. Upscaling a 16px .ico to 512 looks worse than
 * the coloured initial the storefront already falls back to, so a source under MIN_SOURCE_EDGE is
 * skipped and the partner is reported as "no usable logo" rather than given a blurry one.
 */
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { db } from '../src/lib/db'
import { PARTNER_STORES } from '../src/lib/partner-stores'

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
const APPLY = process.argv.includes('--apply')
const ONLY = arg('seller')
const BUCKET = 'listings'
const SIZE = 512
const MIN_SOURCE_EDGE = 64   // below this an upscale looks worse than the initial-letter fallback
const MIN_VISIBLE_PCT = 8    // the CellphoneS blank-circle threshold, measured on the output
const UA = 'Mozilla/5.0 (compatible; eno-partner-logo/1.0)'

/**
 * ⚠️ THESE PARTNERS ARE NOT IN PARTNER_STORES and their domains are not guesses — they are read
 * out of their own affiliate deep links in production
 * (`go.isclix.com/deep_link/…?url=https%3A%2F%2F…`), which is the only place this repo records
 * where those catalogues came from.
 *
 * ⛔ TIKI'S LOGO CAN ONLY BE FETCHED FROM VIETNAM. Measured 2026-09-09: tiki.vn answers a foreign
 * IP with an 18KB bot-challenge page at HTTP **200**, so `res.ok` is true and the "logo" is an
 * HTML document. Run this on the VN box for Tiki, not from a laptop — the same constraint
 * scripts/backfill-tiki-gallery.ts documents at length.
 */
const EXTRA_DOMAINS: Record<string, string> = {
  'BỀN COMPUTER': 'ben.com.vn',
  'Điện Thoại Vui': 'dienthoaivui.com.vn',
  Tiki: 'tiki.vn',
  /**
   * ⚠️ `.com.vn`, NOT `.vn` — and the wrong one does not fail loudly, it just times out. The
   * partner with the SECOND-LARGEST catalogue here (5,955 listings) was reported as
   * "no domain on record" because it was imported by scripts/import-supersports.ts rather than
   * through PARTNER_STORES, so nothing in the logo path had ever heard of it.
   */
  SuperSports: 'supersports.com.vn',
}

function domainFor(name: string): string | null {
  const store = PARTNER_STORES.find((s) => s.name.toLowerCase() === name.toLowerCase())
  // ⚠️ CASE-INSENSITIVE — the key is a human-typed seller name. `SuperSports` was added here to fix
  // a partner reported as "no domain on record"; an exact lookup would have left `Supersports` or
  // `SUPERSPORTS` reporting exactly that, with the entry sitting right there. opus flagged it.
  const extra = Object.entries(EXTRA_DOMAINS).find(([k]) => k.toLowerCase() === name.toLowerCase())
  return store?.domain ?? extra?.[1] ?? null
}

const abs = (href: string, base: string): string | null => {
  try { return new URL(href, base).toString() } catch { return null }
}

/**
 * ⛔ NOT EVERY IMAGE CALLED "logo" IS THE SHOP'S LOGO, AND og:image USUALLY IS NOT ONE AT ALL.
 * MEASURED across these 15 partners on the first run, ranking og:image first picked: a
 * 1920x830 `banner.jpg`, a 1200x630 `thumnail`, an 828x463 `share_fb_home` — social share cards,
 * not marks — plus two badges that ARE logos and are not theirs: `logo-bct.png` is the Ministry of
 * Industry and Trade registration seal every Vietnamese shop displays, and `logo-tra-gop` is an
 * instalment-payment badge. Shipping either would put someone else's mark on a partner storefront.
 */
/**
 * ⛔ THE PAYMENT MARKS ARE HERE ON LICENSING GROUNDS, NOT TIDINESS. Checkout footers carry
 * `visa-logo.png`, `mastercard.svg`, `napas.png`, `momo-logo.png` — all of which match the `/logo/i`
 * filter and score 30, so when a shop's header mark 404s a payment badge could be promoted to that
 * partner's logo on eno.vn. agy caught it. eno.vn is registering as a licensed sàn TMĐT and does not
 * offer card checkout (CLAUDE.md, 2026-07-31); printing a Visa/Mastercard mark advertises a rail the
 * company is not licensed for, and it is someone else's trademark besides.
 *
 * ⚠️ `visa|jcb|amex` CARRY NO TRAILING BOUNDARY AND THAT IS ON PURPOSE — agy asked for one, and
 * adding it is what let `visacard.png` through in the first place. The two failure modes are not
 * symmetric: over-rejecting costs a partner one candidate (the next one, or the initial-letter
 * fallback, is used and the run reports it), while under-rejecting puts a card scheme's mark on a
 * licensed marketplace that does not offer card checkout. `atm` keeps its boundary because it is
 * three letters that begin ordinary words.
 */
/**
 * ⛔ TWO FILTERS, BECAUSE THEY EXEMPT DIFFERENTLY. A share card, a placeholder or the Bộ Công
 * Thương seal is NEVER a partner's own mark, whatever the file is called — `tiki-share-fb.jpg`
 * and `logo-bct-supersports.png` are still not logos. Those live in REJECT_ALWAYS and have no
 * exemption at all. A payment or courier BRAND is different: it is somebody else's mark on most
 * shops' footers, and its own mark on `momo.vn`.
 * ⚠️ AN EARLIER VERSION EXEMPTED BOTH, KEYED ON THE URL CONTAINING THE DOMAIN — which is every
 * self-hosted asset, so it disabled the whole filter; narrowing it to the filename only shrank the
 * hole (`tiki-visa.png` still walked through). Both seats found each version. The exemption below
 * turns on whether the PARTNER is that brand, not on what the file is called.
 */
const REJECT_ALWAYS = /(banner|thumb?nail|share[_-]?fb|social|cover|promotion|vpbank|tra-?gop|installment|[-_/]bct[-_.]|bo-?cong-?thuong|dathongbao|placeholder|sprite|loyalty|the-?one|the1|dmca|^data:|(?:^|[-_/])(?:blank|spacer|lazy|dummy|transparent|1x1|px|loading|noimage|no-image|default|empty)(?:[-_.]|$))/i
const REJECT_BRAND = /((?<![a-z])(?:visa|jcb|amex)|(?<![a-z])atm(?![a-z])|mastercard|american-?express|union-?pay|napas|momo|zalo-?pay|vn-?pay|viettel-?pay|payoo|shopee-?pay|pay-?pal|apple-?pay|google-?pay|samsung-?pay|kredivo|payment|thanh-?toan|ghn(?![a-z])|giao-?hang-?nhanh|giao-?hang-?tiet-?kiem|ghtk(?![a-z])|viettel-?post|vn-?post|ahamove|grab-?express|ninja-?van|best-?express|j-?t-?express)/i
/**
 * A mark is roughly square or a wordmark; a share card is a letterbox. Raised from 4 after the
 * filename filter proved to be what actually catches banners (the 1920x830 one measured 2.3:1 and
 * sailed through), while 4 was rejecting two partners' real wordmarks — Di Động Việt's logo.svg at
 * 5.7:1 and Điện Thoại Vui's at 5.0:1. A wordmark letterboxed into the square is small but correct;
 * refusing it leaves the storefront with an initial instead of the brand.
 */
const MAX_ASPECT = 6

/** Logo candidates from a partner's homepage, best first. */
async function candidates(domain: string): Promise<string[]> {
  const base = `https://${domain}`
  let html = ''
  try {
    const res = await fetch(base, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(25_000) })
    if (!res.ok) return []
    html = await res.text()
  } catch { return [] }

  /**
   * ⛔ RANKED, NOT JUST ORDERED — AND THE STRONGEST SIGNAL IS THE SHOP'S OWN NAME IN THE FILENAME.
   * A retailer's homepage is full of OTHER brands' marks: ranking by source alone made 24hStore
   * pick `logo-qcy_…` (QCY is a headphone brand in their mega-menu) over their own
   * `logo-web-24hstore_….png`. Every one of these shops names its own asset after itself, so the
   * domain's distinctive token is what separates "their logo" from "a logo they display".
   */
  const token = domain.replace(/\.(vn|com|net|com\.vn)$/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase()
  const scored: Array<{ u: string; score: number }> = []
  const push = (u: string | null, base_score: number) => {
    if (!u || scored.some((x) => x.u === u)) return
    /**
     * ⛔ NEVER REJECT THE PARTNER'S OWN MARK. `REJECT_NAME` carries payment and courier brands
     * (`momo`, `napas`, `ghn`, `viettel-post`) precisely because they appear in other shops'
     * footers — but any of them could BE a partner here, and then the filter takes not one
     * candidate but every candidate, and the storefront silently falls back to an initial letter.
     * opus caught the asymmetry: the comment justified over-rejecting on OTHER shops' pages and
     * did not cover the shop itself. The domain's own token is the exemption.
     */
    if (REJECT_ALWAYS.test(u)) return // never a partner's own mark, whatever it is named
    /**
     * ⚠️ THE EXEMPTION COMPARES THE *MATCHED* BRAND TO THE PARTNER, NOT "matches any". Written as
     * `!REJECT_BRAND.test(token)` it was all-or-nothing: for `momo.vn` it disabled the brand filter
     * ENTIRELY, so momo's own footer `visa-logo.png` and `mastercard.svg` became eligible at 30 —
     * on exactly the shops most likely to display them. opus caught it. MoMo may show MoMo's mark
     * and nobody else's.
     */
    // ⛔ MATCH THE BRAND IN THE *PATH*, NOT THE URL — for the third time in this file, `u` is
    // absolute, so `https://momo.vn/img/visa-logo.png` matched `momo` (the HOST) first, called it
    // the partner's own mark and let Visa through. The host is never evidence about the asset.
    /**
     * ⛔ THE PATH, NOT THE WHOLE URL — this file's oldest lesson and it has now caught three
     * separate bugs. `u` is absolute, so every self-hosted asset URL already contains the domain
     * token: the own-name BONUS below fired on all of them and ranked nothing (opus, reviewing an
     * earlier revision), and the brand check fired on the HOST, reading `momo.vn/img/visa-logo.png`
     * as MoMo's own mark. One `path`, computed once, used by both.
     */
    const path = (() => { try { return new URL(u).pathname } catch { return u } })()
    /**
     * ⚠️ EVERY BRAND IN THE PATH, NOT THE FIRST ONE. `exec` returns the earliest match, and a
     * payment partner files its card marks under its own name — `/static/momo/payment/visa.png`
     * matched `momo`, was read as "the partner's own mark" and let Visa through, where the +100
     * own-name bonus would then have ranked it ABOVE the real logo. agy caught it. One foreign
     * brand anywhere in the path is enough to reject.
     */
    const brands = [...path.matchAll(new RegExp(REJECT_BRAND.source, 'gi'))]
      .map((b) => b[1].toLowerCase().replace(/[^a-z0-9]/g, ''))
    if (brands.some((b) => b !== token)) return
    if (/\/(menus?|brands?|partners?|payments?)\//i.test(u)) return // a tile for someone else's brand
    const own = token && path.replace(/[^a-z0-9]/gi, '').toLowerCase().includes(token) ? 100 : 0
    scored.push({ u, score: base_score + own })
  }

  for (const m of html.matchAll(/<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]*href=["']([^"']+)["']/gi)) push(abs(m[1], base), 50)
  /**
   * ⚠️ ONE PASS PER <img>, TAKING `src` AND `srcset` TOGETHER. They used to be two sequential
   * matchAll loops, which quietly broke the tie-breaking this relies on: EVERY src in the document
   * was pushed before ANY srcset, so a footer payment badge with a working src outranked the
   * header mark whose src 404s. agy caught it. Reading both attributes off the same tag keeps
   * document order meaningful, which is what makes "the header mark wins" true rather than hopeful.
   */
  for (const m of html.matchAll(/<img[^>]+>/gi)) {
    if (!/logo/i.test(m[0])) continue
    /**
     * ⛔ EVERY src-LIKE ATTRIBUTE, NOT THE FIRST ONE. `/(?:src|data-src)=…/.exec()` returns the
     * EARLIEST match in the tag, and the lazy-load idiom writes them in exactly the wrong order:
     * `<img src="blank.gif" data-src="logo.png">` handed back the 1×1 placeholder and the real mark
     * was never even scored. The pattern this replaced used a greedy `[^>]+` prefix, which
     * backtracked to the LAST such attribute and happened to get it right; the rewrite silently
     * inverted that. opus caught it. Pushing all of them removes the precedence question entirely —
     * `push()` already dedupes and `REJECT_NAME` drops the placeholder.
     */
    /**
     * ⛔ THE PREFERENCE IS PER TAG, NOT A GLOBAL SCORE. Two earlier attempts got this wrong in
     * opposite directions and the panel caught both: pushing `src` and `data-src` at the SAME score
     * left the tie to document order, where `src` is written first, so the placeholder still won;
     * scoring `data-src` HIGHER then inverted document order globally, and since lazy-loading is
     * exactly what below-the-fold images use, a lazy footer badge outranked the eager header mark.
     * ⚠️ RESOLVING INSIDE THE TAG KEEPS BOTH PROPERTIES: the lazy attribute wins its own tag, and
     * tags still rank by where they appear — which is what makes "the header mark wins" true.
     */
    const lazy = /(?:data-src|data-original|data-lazy-src|data-echo)=["']([^"']+)["']/i.exec(m[0])
    const eager = /(?<![-\w])src=["']([^"']+)["']/i.exec(m[0])
    /**
     * ⛔ GUARD THE EMPTY MATCH. `<img class="logo" srcset="…">` carries neither attribute, and
     * `new URL('', base)` resolves to `base` — so the partner's HTML homepage was pushed as an image
     * candidate at 30, ahead of rel=icon (20) and the favicon (10). Both seats found it independently;
     * the `srcset` branch below already had the `if (u)` this one was missing.
     */
    /**
     * ⚠️ `srcset` RANKS WITH THE LAZY ATTRIBUTE, ABOVE A BARE `src`. agy's case:
     * `<img src="placeholder.png" srcset="logo.png 1x, logo@2x.png 2x">` has no lazy attribute, so
     * `src` was taken as `best` and pushed at 30 before the srcset candidates — which are also 30,
     * so document order handed it to the placeholder. Responsive markup uses `src` as the fallback
     * for old browsers exactly the way lazy markup does, so it loses to `srcset` for the same reason.
     * ⛔ AND `eager[1]` CAN BE THE EMPTY STRING. `<img src="" data-src="logo.png">` is ordinary lazy
     * markup; `abs('', base)` is the homepage, so the demoted-fallback push re-introduced at 12 the
     * exact bug the `best` guard had just closed at 30. Both seats caught it. Guard every push.
     */
    // ⚠️ NO COMMA IN THE CHARACTER CLASS — a CDN transform path carries them (Cloudinary
    // `/w_300,h_300/logo.png`) and excluding the comma severed the URL into a 404 fragment, which
    // was then pushed as `best` at 30 AND demoted the valid `src`. agy caught it. The srcset
    // grammar separates the URL from its descriptor with WHITESPACE, so whitespace is the terminator.
    const srcsetFirst = /srcset=["']\s*([^"'\s]+)/i.exec(m[0])?.[1]
    const best = lazy?.[1] || srcsetFirst || eager?.[1]
    if (best) push(abs(best, base), 30)
    if ((lazy?.[1] || srcsetFirst) && eager?.[1]) push(abs(eager[1], base), 8) // below the favicon
    const ss = /srcset=["']([^"']+)["']/i.exec(m[0])
    // ⚠️ SPLIT ON `,` + WHITESPACE. A bare comma also sits INSIDE CDN transform paths
    // (Cloudinary `/w_300,h_300/`), so `split(',')` cut real URLs in half and pushed 404s. The
    // srcset grammar puts whitespace after the separating comma; a transform path does not.
    if (ss) for (const part of ss[1].split(/,\s+/)) {
      const u = part.trim().split(/\s+/)[0]
      if (u) push(abs(u, base), 30)
    }
  }
  for (const m of html.matchAll(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*href=["']([^"']+)["']/gi)) push(abs(m[1], base), 20)
  push(`${base}/favicon.png`, 10)
  push(`${base}/favicon.ico`, 10)
  for (const m of html.matchAll(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/gi)) {
    if (/logo/i.test(m[1])) push(abs(m[1], base), 5)
  }
  return scored.sort((a, b) => b.score - a.score).map((x) => x.u).slice(0, 14)
}

type Attempt = { url: string; skipped?: string; width?: number; height?: number; visible?: number; out?: Buffer; onDark?: boolean }

/** Fetch one candidate and put it through the same pipeline set-partner-avatar.ts uses. */
/**
 * ⛔⛔ CANDIDATE URLS COME OUT OF A THIRD PARTY'S HTML AND ARE FETCHED SERVER-SIDE. Without this
 * check, a partner homepage (or anyone who can inject one tag into it) could point this script at
 * `http://127.0.0.1:8000/`, `http://169.254.169.254/latest/meta-data/` or any internal host, and
 * the request would originate from the production VN box — which shares a Docker network with
 * Postgres, the Supabase gateway and both app containers (codex, reviewing this file). Public
 * HTTP(S) hosts only, and no credentials smuggled in the authority.
 */
function isPublicHttpUrl(u: string): boolean {
  let url: URL
  try { url = new URL(u) } catch { return false }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  if (url.username || url.password) return false
  const h = url.hostname.toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return false
  // ⛔ A SINGLE-LABEL HOSTNAME IS A DOCKER SERVICE NAME, NOT A WEBSITE. `http://db:5432/`,
  // `http://eno-mt:8088/` and `http://supabase-rest/` all resolve on the network this runs on;
  // every real partner asset host has a dot in it. This is what closes the resolution gap the
  // literal-IP list below cannot see.
  if (!h.includes('.')) return false
  // Literal private / link-local / loopback ranges. A PUBLIC hostname that resolves to a private
  // address still gets through — closing that needs resolution-time checking, which fetch() does
  // not expose. Accepted: this script is operator-run, not request-driven.
  if (/^(127\.|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::1$|\[)/.test(h)) return false
  return true
}

/** Refuse a download larger than this rather than buffering whatever a host chooses to send. */
const MAX_LOGO_BYTES = 8 * 1024 * 1024

async function render(url: string): Promise<Attempt> {
  if (!isPublicHttpUrl(url)) return { url, skipped: 'refused: not a public http(s) url' }
  let src: Buffer
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(25_000) })
    if (!res.ok) return { url, skipped: `HTTP ${res.status}` }
    // ⚠️ Bounded BEFORE buffering. `arrayBuffer()` on an unbounded response lets a candidate
    // decide how much memory this process uses (codex).
    const declared = Number(res.headers.get('content-length') || 0)
    if (declared > MAX_LOGO_BYTES) return { url, skipped: `too large (${declared} bytes)` }
    src = Buffer.from(await res.arrayBuffer())
    if (src.byteLength > MAX_LOGO_BYTES) return { url, skipped: `too large (${src.byteLength} bytes)` }
  } catch (e) { return { url, skipped: `fetch: ${(e as Error).message.slice(0, 40)}` } }

  const sharp = (await import('sharp')).default
  let meta
  try { meta = await sharp(src).metadata() } catch { return { url, skipped: 'not a decodable image' } }
  const edge = Math.max(meta.width ?? 0, meta.height ?? 0)
  if (edge < MIN_SOURCE_EDGE) return { url, skipped: `only ${meta.width}x${meta.height} — too small to upscale`, width: meta.width, height: meta.height }
  // A logo is roughly square or a modest wordmark; 1920x830 is a banner wearing a logo's filename.
  const aspect = Math.max(meta.width ?? 1, meta.height ?? 1) / Math.max(1, Math.min(meta.width ?? 1, meta.height ?? 1))
  if (aspect > MAX_ASPECT) return { url, skipped: `${meta.width}x${meta.height} is ${aspect.toFixed(1)}:1 — a banner, not a mark`, width: meta.width, height: meta.height }

  // Flattened onto white, not left transparent: the avatar renders on dark chips and coloured
  // cards, and a cut-out would pick up whatever sits behind it.
  const out = await sharp(src)
    .resize(SIZE, SIZE, { fit: 'contain', background: '#ffffff' })
    .flatten({ background: '#ffffff' })
    .webp({ quality: 92 })
    .toBuffer()

  /**
   * ⛔ MEASURE THE INK IN THE LOGO, NOT IN THE PADDING I ADDED. The first version measured across
   * the whole 512x512 canvas, which silently penalised every WORDMARK: Di Động Việt's 3738x661
   * mark letterboxes to a 512x90 strip, so even solid ink scores ~6% of the square and was refused
   * as "the light-on-dark variant" — a conclusion about the logo drawn from a property of the
   * frame. The measurement is taken on a `fit: inside` render (no letterbox); the padded square is
   * still what gets STORED.
   */
  const gauge = (bg: string) => sharp(src).resize(SIZE, SIZE, { fit: 'inside' }).flatten({ background: bg }).png().toBuffer()
  const inkPct = async (buf: Buffer, dark: boolean) => {
    const { data } = await sharp(buf).greyscale().raw().toBuffer({ resolveWithObject: true })
    let n = 0
    for (const px of data) if (dark ? px > 60 : px < 245) n++
    return (n / data.length) * 100
  }

  const pct = await inkPct(await gauge('#ffffff'), false)
  if (pct >= MIN_VISIBLE_PCT) return { url, width: meta.width, height: meta.height, visible: pct, out }

  /**
   * ⛔ A MARK THAT VANISHES ON WHITE IS NOT NECESSARILY THE WRONG FILE — IT MAY BE THE ONLY FILE.
   * 24hStore publishes exactly one logo and it is white-on-transparent (0.0% visible on white), so
   * refusing it left a real partner with no mark at all. When the source HAS an alpha channel, the
   * honest reading is "this is a light-on-dark logo", and the fix is the background it was drawn
   * for: flatten onto near-black and measure the ink there instead. A source with no alpha gets no
   * second chance — a white JPEG box is still a white box on any background.
   */
  if (meta.hasAlpha) {
    const dark = await sharp(src)
      .resize(SIZE, SIZE, { fit: 'contain', background: '#111111' })
      .flatten({ background: '#111111' })
      .webp({ quality: 92 })
      .toBuffer()
    const dpct = await inkPct(await gauge('#111111'), true)
    if (dpct >= MIN_VISIBLE_PCT) return { url, width: meta.width, height: meta.height, visible: dpct, out: dark, onDark: true }
  }
  return { url, skipped: `only ${pct.toFixed(1)}% visible on white${meta.hasAlpha ? ' and no better on dark' : ' (no alpha — not a light-on-dark variant)'}`, visible: pct }
}

async function main() {
  const partners = await db.seller.findMany({
    where: { officialPartner: true, ...(ONLY ? { name: ONLY } : {}) },
    select: { id: true, name: true, avatarUrl: true },
    orderBy: { name: 'asc' },
  })
  // ⚠️ NEVER OVERWRITE A LOGO SOMEONE ALREADY CHOSE. A partner whose avatar was set by hand (or by
  // set-partner-avatar.ts, after a human picked the colour variant) must not be replaced by
  // whatever their homepage happens to serve today.
  const todo = partners.filter((p) => !p.avatarUrl)
  console.log(`${partners.length} official partners, ${partners.length - todo.length} already have a logo, ${todo.length} to fetch\n`)

  const storageUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '')
  const key = process.env.SUPABASE_SECRET_KEY
  if (APPLY) {
    if (!storageUrl || !key) { console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY required'); process.exit(1) }
    if (/supabase\.co$/.test(new URL(storageUrl).hostname)) { console.error(`Refusing to upload to ${storageUrl} — retired project`); process.exit(1) }
  }
  const storage = APPLY ? createClient(storageUrl!, key!, { auth: { persistSession: false } }).storage.from(BUCKET) : null

  let done = 0, failed: string[] = []
  for (const p of todo) {
    const domain = domainFor(p.name)
    if (!domain) { console.log(`${p.name.padEnd(22)} ⛔ no domain on record`); failed.push(p.name); continue }

    const urls = await candidates(domain)
    if (!urls.length) { console.log(`${p.name.padEnd(22)} ⛔ ${domain}: homepage unreachable or no candidates`); failed.push(p.name); continue }

    let picked: Attempt | null = null
    const tried: string[] = []
    for (const u of urls) {
      const a = await render(u)
      if (a.out) { picked = a; break }
      tried.push(`      ${a.skipped}  ${u.slice(0, 70)}`)
    }
    if (!picked) {
      console.log(`${p.name.padEnd(22)} ⛔ ${domain}: ${urls.length} candidates, none usable`)
      for (const t of tried.slice(0, 4)) console.log(t)
      failed.push(p.name); continue
    }

    console.log(`${p.name.padEnd(22)} ✓ ${picked.width}x${picked.height}, ${picked.visible!.toFixed(0)}% ink${picked.onDark ? ' ON DARK' : ''}  ${picked.url.slice(0, 58)}`)
    if (!APPLY) continue

    const name = `partner/avatar-${p.id}-${Date.now().toString(36)}.webp`
    const { error } = await storage!.upload(name, picked.out!, { contentType: 'image/webp', upsert: false, cacheControl: '31536000' })
    if (error) { console.error(`      upload failed: ${error.message}`); failed.push(p.name); continue }
    await db.seller.update({ where: { id: p.id }, data: { avatarUrl: `${storageUrl}/storage/v1/object/public/${BUCKET}/${name}` } })
    done++
  }

  console.log(APPLY ? `\nAPPLIED: ${done} logos set${failed.length ? `, ${failed.length} without one: ${failed.join(', ')}` : ''}` : '\nDRY RUN — re-run with --apply.')
  if (APPLY && done) console.log('NEXT: node scripts/purge-isr-listings.mjs   (storefront cards are baked into ISR pages)')
  await db.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
