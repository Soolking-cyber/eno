import 'server-only'
import type { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { scopedListingWhere } from '@/lib/edition-scope'
import { cutText } from '@/lib/feed-text'
import { logError } from '@/lib/log'
import enoImageLoader from '@/lib/image-loader'
import { displayPriceUnit, priceUnitSuffix } from '@/lib/price-unit'
import { publicFeedListingWhere } from '@/lib/schema-feed'
import { safeParse } from '@/lib/serialize'
import { LICENCE_CHECK_SUBCATEGORIES, VISA_SUBCATEGORY_SLUG } from '@/lib/taxonomy'
import { cardCompactAbove, compactVnd, compactVndStep, formatMoneyFull, type MoneyLocale } from '@/lib/vnd'

/**
 * iOS 1.3 — what the app's SYSTEM surfaces show (owner, 2026-11-23: "make it super native" → a Home Screen widget and rich
 * notifications). Not screens: the widget is a few listing tiles that open the listing in the app, and a chat notification
 * carries its listing's photo. The app still mirrors the web; these are the web's own cards, served as data.
 *
 * ⛔ NEVER VISA, ITINERARY OR e-VISA (CLAUDE.md "Shipping"). Both surfaces read through the marketplace's edition scope (the
 * desk's listings never — and native push never leaves the services build at all, native-push.ts), and NOT_ON_APP_SURFACES
 * takes out the e-Visa and legal-permits aisles and visa runs as well — a Home Screen tile or a lock-screen photo is the
 * licensed company's app speaking, wherever the listing came from.
 */

/**
 * The app's own origin — AppDelegate.appOrigin / capacitor.config.ts `server.url`. The widget (EnoWidgets) and the
 * notification extension (EnoNotify) fetch photos from this host only, so every URL handed to them is on it, whatever
 * NEXT_PUBLIC_APP_URL the build carries.
 */
export const APP_ORIGIN = 'https://eno.vn'

/** The aisles no app surface shows (above). A null subcategory is kept — `notIn` alone would drop it in SQL. */
export const NOT_ON_APP_SURFACES: Prisma.ListingWhereInput = {
  OR: [{ subcategorySlug: null }, { subcategorySlug: { notIn: [...new Set([VISA_SUBCATEGORY_SLUG, ...LICENCE_CHECK_SUBCATEGORIES, 'visa-runs'])] } }],
}

/**
 * A listing photo exactly as a card's <Image> asks the site's optimizer for it (image-loader.ts), on the app's origin, at a
 * width next.config allows (256 for a widget tile, 640 for a notification). null for anything that is not an https or a
 * root-relative image src the optimizer serves (the widget and EnoNotify accept /_next/image on eno.vn and nothing else).
 */
export function appImageUrl(src: unknown, width: 256 | 640): string | null {
  if (typeof src !== 'string') return null
  const local = src.startsWith('/') && !src.startsWith('//') && !src.startsWith('/\\')
  if (!local && !/^https:\/\/[^/\\\s?#@]+\//i.test(src)) return null
  // Only the optimizer's answer: a local file the loader serves as-is is not a photo the app surfaces fetch.
  const path = enoImageLoader({ src, width, quality: 60 })
  return path.startsWith('/_next/image?') ? `${APP_ORIGIN}${path}` : null
}

function firstPhoto(images: string | null | undefined, width: 256 | 640): string | null {
  const list = safeParse<unknown>(images ?? null, [])
  return Array.isArray(list) ? appImageUrl(list.find((s) => typeof s === 'string'), width) : null
}

const SHORT_UNIT_EN: ReadonlyMap<string, string> = new Map([['month', 'mo'], ['week', 'wk'], ['day', 'day'], ['hour', 'hr']])
const UNIT_VI: ReadonlyMap<string, string> = new Map([['month', 'tháng'], ['week', 'tuần'], ['day', 'ngày'], ['hour', 'giờ']])

export type PricedRow = { price: number; currency: string; priceUnit: string | null; listingType: string | null; sellerId: string | null }

/**
 * A listing card's price line as plain text (price.tsx <Price native compact shortUnit cardWords> with the card's
 * cardCompactAbove): "12.8M đ", "8.5M đ/mo", "8,5 triệu / tháng", "350,000 đ", "Free", "Negotiable". No "≈ $": the
 * tile is narrower than a card and đồng is the price (ND 340/2025 has it lead; nothing follows it here).
 */
export function cardPriceText(l: PricedRow, lang: MoneyLocale): string {
  const vi = lang === 'vi'
  if (l.price === 0) {
    if (l.listingType === 'job') return vi ? 'Thỏa thuận' : 'Negotiable'
    if (l.listingType === 'teacher') return vi ? 'Thù lao: liên hệ' : 'Rate on request'
    return vi ? 'Miễn phí' : 'Free'
  }
  const priceUnit = displayPriceUnit(l.priceUnit ?? '', l.sellerId)
  const unit = priceUnitSuffix(priceUnit)
  let amount = formatMoneyFull(l.price, l.currency, lang)
  if (l.currency === '₫' && l.price >= cardCompactAbove({ price: l.price, prevPrice: null, priceUnit })) {
    const step = compactVndStep(l.price)
    amount = l.price % step === 0 ? compactVnd(l.price, lang) : `≈ ${compactVnd(Math.round(l.price / step) * step, lang)}`
  }
  if (!unit) return amount
  if (vi) return `${amount} / ${UNIT_VI.get(unit) ?? unit}`
  const short = SHORT_UNIT_EN.get(unit)
  return short ? `${amount}/${short}` : `${amount} / ${unit}`
}

// ───────────────────────────── The widget: "New on eno" ─────────────────────────────

export type WidgetItem = { id: string; title: string; price: string; image: string }
export type WidgetFeed = Record<MoneyLocale, WidgetItem[]>

/** The most tiles a widget draws (the large one: 2 × 3) plus spares for a photo that fails to load on the phone. */
export const WIDGET_ITEMS = 8
const WIDGET_READ = 40

export type WidgetRow = PricedRow & { id: string; title: string; titleVi: string | null; images: string }

/** Rows (newest first) → the tiles for both languages. A row without a usable photo is skipped: a tile is its photo. */
export function widgetItems(rows: WidgetRow[]): WidgetFeed {
  const feed: WidgetFeed = { en: [], vi: [] }
  for (const r of rows) {
    if (feed.en.length >= WIDGET_ITEMS) break
    const image = firstPhoto(r.images, 256)
    if (!image) continue
    for (const lang of ['en', 'vi'] as const) {
      const title = (lang === 'vi' && r.titleVi?.trim()) || r.title
      feed[lang].push({ id: r.id, title: cutText(title.replace(/\s+/g, ' ').trim(), 90), price: cardPriceText(r, lang), image })
    }
  }
  return feed
}

/**
 * The newest listings the site publishes to everyone — /feed.xml's set (publicFeedListingWhere: the sitemap's listings,
 * edition-scoped, verified and active, no affiliate or thin import, no teacher's shop) minus NOT_ON_APP_SURFACES.
 * ⛔ No seller, no contact, no person: a tile is a photo, a title and a price, the three things the listing's card shows.
 */
async function readWidgetFeed(): Promise<WidgetFeed> {
  const rows = await db.listing.findMany({
    // edition-lint-allow: publicFeedListingWhere() is submittedListingWhere() (edition-scoped) minus teachers' shops.
    where: { AND: [await publicFeedListingWhere(), NOT_ON_APP_SURFACES] },
    select: { id: true, title: true, titleVi: true, images: true, price: true, currency: true, priceUnit: true, listingType: true, sellerId: true },
    orderBy: [{ postedAt: 'desc' }, { id: 'desc' }],
    take: WIDGET_READ,
  })
  return widgetItems(rows)
}

/**
 * HELD IN THIS PROCESS FOR 10 MINUTES, the /feed.xml shape (src/app/feed.xml/route.ts): one read per window per container
 * however many phones refresh, concurrent requests share it, a stale feed (≤ 30 min) is served while the next builds, a
 * failed read waits 60 s before the next, and past 30 min the answer is null (the route says 503 and the widget keeps
 * its last tiles) rather than tiles for listings that may have been taken down since. The route's shared-cache window adds
 * at most 10 minutes; the widget keeps its own last tiles (≤ 12 h) only while it cannot reach the site.
 */
const TTL_MS = 600_000
const MAX_STALE_MS = 1_800_000
const RETRY_MS = 60_000
let held: { feed: WidgetFeed; at: number } | null = null
let building: Promise<WidgetFeed | null> | null = null
let failedAt = 0

export function widgetFeed(): Promise<WidgetFeed | null> {
  const now = Date.now()
  if (held && now - held.at < TTL_MS) return Promise.resolve(held.feed)
  if (!building && now - failedAt >= RETRY_MS) {
    building = Promise.race([readWidgetFeed(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('widget feed read timed out')), 30_000))])
      .then((feed): WidgetFeed | null => { held = { feed, at: Date.now() }; return feed })
      // Never rejects: a failed read is logged here and answers null (no feed yet), whoever awaits it.
      .catch((error) => { failedAt = Date.now(); logError(error, { op: 'native-surfaces.widgetFeed' }); return null })
      .finally(() => { building = null })
  }
  const usable = held && now - held.at < MAX_STALE_MS ? held.feed : null
  if (usable) return Promise.resolve(usable)
  return building ?? Promise.resolve(null)
}

/** Tests only: forget the held feed. */
export function resetWidgetFeedForTest(): void {
  held = null
  building = null
  failedAt = 0
}

// ───────────────────────────── A chat notification's photo ─────────────────────────────

/**
 * The photo of the listing a conversation is about, for its notification (EnoNotify attaches it), or null: a support
 * thread (no listing), a listing the public cannot see now (held, hidden, sold — `verified` + `active`, what the page
 * serves), the edition scope's exclusions (the desk; a teacher, whose "photo" is a person's portrait on a lock screen), an
 * aisle NOT_ON_APP_SURFACES leaves out, or no photo.
 */
export async function chatPushPhoto(conversationId: string): Promise<string | null> {
  const listing = await db.listing.findFirst({
    where: await scopedListingWhere({ AND: [{ conversations: { some: { id: conversationId } } }, { verified: true, status: 'active' }, NOT_ON_APP_SURFACES] }),
    select: { images: true },
  })
  return listing ? firstPhoto(listing.images, 640) : null
}
