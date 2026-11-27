import { IS_SERVICES } from '@/lib/edition'
import type { LangVariant } from '@/lib/lang-variant'

/**
 * ⛔ THE PAGES WHOSE LANGUAGE IS FIXED BY THEIR URL, NOT BY THE VISITOR (SEO wave B, V1).
 *
 * Every other page negotiates: src/proxy.ts rewrites it into `/en/…` or `/vi/…` from the `lang`
 * cookie, then Accept-Language (src/lib/lang-variant.ts). That is right for a page whose words are
 * all UI strings. It is wrong for a guide: the article's prose is written in ONE language and has its
 * own slug in the other (`/thanh-ly-do-gia-dung-cu-tphcm` ↔ `/secondhand-furniture-ho-chi-minh-city`),
 * so negotiating the chrome around it produced a Vietnamese article under English chrome — "On this
 * page", the header, the footer — for Googlebot (which sends no Accept-Language, so it got English) and
 * for every English browser that followed a Vietnamese link. Search engines read that page as mixed.
 *
 * So these paths render in their article's language for everyone. No new URL is created, no redirect
 * is added, and canonical and hreflang are unchanged: a guide's pair already carries the other
 * language (src/lib/expat-guides.ts `marketplaceGuideAlternates`, src/lib/phone-guides.ts).
 *
 * ⚠️ A LITERAL LIST, NOT AN IMPORT OF THE REGISTRIES, AND THE REASON IS THE BUNDLE. The proxy runs on
 * every page request and the provider ships to every visitor; importing the registries would carry
 * every label and blurb into both. lang-pinned.test.ts holds this list EQUAL to the registries in
 * both directions — slug, language and pair — so a guide added there fails the suite until it is
 * added here, and one removed there fails until it is removed here.
 *
 * ⚠️ ONLY GUIDES THAT DECLARE A `lang`. The English-only originals with no `lang` (furnishing,
 * selling-up and the two services guides) keep negotiating, as the plan counts them (V-f pins the
 * English guides that have a declared language). The vehicle hubs (2026-09-29) declare one, so
 * they are here.
 *
 * ⚠️ BOTH EDITIONS (decision V-i): the guides are ordinary `page.tsx` routes on eno.forum too, which the
 * app loads. The one exclusion is a storefront host (`apple.eno.vn/<guide>`), which the proxy leaves
 * negotiating, as it leaves every other storefront path.
 */
export const FIXED_LANG: Readonly<Record<string, { lang: LangVariant; pair?: string }>> = {
  // ── Phone guides (src/lib/phone-guides.ts), 18 pairs ─────────────────────────────────────────
  'best-place-to-buy-iphone-vietnam': { lang: 'en', pair: 'mua-iphone-o-dau-uy-tin' },
  'mua-iphone-o-dau-uy-tin': { lang: 'vi', pair: 'best-place-to-buy-iphone-vietnam' },
  'chinh-hang-vs-xach-tay-vietnam': { lang: 'en', pair: 'iphone-chinh-hang-va-xach-tay' },
  'iphone-chinh-hang-va-xach-tay': { lang: 'vi', pair: 'chinh-hang-vs-xach-tay-vietnam' },
  'buying-a-used-iphone-vietnam': { lang: 'en', pair: 'kinh-nghiem-mua-iphone-cu' },
  'kinh-nghiem-mua-iphone-cu': { lang: 'vi', pair: 'buying-a-used-iphone-vietnam' },
  'phone-instalments-vietnam': { lang: 'en', pair: 'mua-dien-thoai-tra-gop' },
  'mua-dien-thoai-tra-gop': { lang: 'vi', pair: 'phone-instalments-vietnam' },
  'iphone-18-vs-iphone-17-vietnam': { lang: 'en', pair: 'co-nen-len-doi-iphone-18' },
  'co-nen-len-doi-iphone-18': { lang: 'vi', pair: 'iphone-18-vs-iphone-17-vietnam' },
  'iphone-vs-samsung-vietnam': { lang: 'en', pair: 'nen-mua-iphone-hay-samsung' },
  'nen-mua-iphone-hay-samsung': { lang: 'vi', pair: 'iphone-vs-samsung-vietnam' },
  'foldable-phones-vietnam': { lang: 'en', pair: 'dien-thoai-gap-nen-mua-loai-nao' },
  'dien-thoai-gap-nen-mua-loai-nao': { lang: 'vi', pair: 'foldable-phones-vietnam' },
  'esim-vietnam-guide': { lang: 'en', pair: 'esim-viettel-vinaphone-mobifone' },
  'esim-viettel-vinaphone-mobifone': { lang: 'vi', pair: 'esim-vietnam-guide' },
  'vat-refund-phone-vietnam': { lang: 'en', pair: 'hoan-thue-vat-mua-dien-thoai' },
  'hoan-thue-vat-mua-dien-thoai': { lang: 'vi', pair: 'vat-refund-phone-vietnam' },
  'ipad-buying-guide-vietnam': { lang: 'en', pair: 'mua-ipad-loai-nao-tot' },
  'mua-ipad-loai-nao-tot': { lang: 'vi', pair: 'ipad-buying-guide-vietnam' },
  'budget-5g-phones-vietnam': { lang: 'en', pair: 'dien-thoai-5g-gia-re' },
  'dien-thoai-5g-gia-re': { lang: 'vi', pair: 'budget-5g-phones-vietnam' },
  'phone-warranty-repair-vietnam': { lang: 'en', pair: 'bao-hanh-sua-chua-dien-thoai' },
  'bao-hanh-sua-chua-dien-thoai': { lang: 'vi', pair: 'phone-warranty-repair-vietnam' },
  'selling-your-phone-vietnam': { lang: 'en', pair: 'ban-dien-thoai-cu-duoc-gia' },
  'ban-dien-thoai-cu-duoc-gia': { lang: 'vi', pair: 'selling-your-phone-vietnam' },
  'best-value-phones-vietnam': { lang: 'en', pair: 'dien-thoai-tam-trung-dang-mua' },
  'dien-thoai-tam-trung-dang-mua': { lang: 'vi', pair: 'best-value-phones-vietnam' },
  'samsung-galaxy-buying-guide-vietnam': { lang: 'en', pair: 'mua-samsung-galaxy-dong-nao' },
  'mua-samsung-galaxy-dong-nao': { lang: 'vi', pair: 'samsung-galaxy-buying-guide-vietnam' },
  'iphone-battery-replacement-vietnam': { lang: 'en', pair: 'thay-pin-iphone-o-dau' },
  'thay-pin-iphone-o-dau': { lang: 'vi', pair: 'iphone-battery-replacement-vietnam' },
  'phones-under-10-million-vietnam': { lang: 'en', pair: 'dien-thoai-duoi-10-trieu' },
  'dien-thoai-duoi-10-trieu': { lang: 'vi', pair: 'phones-under-10-million-vietnam' },
  'phone-accessories-vietnam': { lang: 'en', pair: 'phu-kien-dien-thoai-nen-mua' },
  'phu-kien-dien-thoai-nen-mua': { lang: 'vi', pair: 'phone-accessories-vietnam' },
  // ── Marketplace guides (src/lib/expat-guides.ts MARKETPLACE_GUIDES) with a declared language ──
  'secondhand-furniture-ho-chi-minh-city': { lang: 'en', pair: 'thanh-ly-do-gia-dung-cu-tphcm' },
  'thanh-ly-do-gia-dung-cu-tphcm': { lang: 'vi', pair: 'secondhand-furniture-ho-chi-minh-city' },
  'do-cu-cua-nguoi-nuoc-ngoai': { lang: 'vi' },
  'renting-an-apartment-vietnam-foreigner': { lang: 'en' },
  'rental-deposit-vietnam': { lang: 'en' },
  'ban-do-cu-o-dau-duoc-gia': { lang: 'vi' },
  'dang-tin-ban-hang-mien-phi': { lang: 'vi' },
  // The vehicle hubs (vehicle-hub.tsx renders them through SeoArticle, prose in the page's language).
  'car-rental-ho-chi-minh-city': { lang: 'en', pair: 'thue-xe-tu-lai-tphcm' },
  'thue-xe-tu-lai-tphcm': { lang: 'vi', pair: 'car-rental-ho-chi-minh-city' },
  'motorbike-rental-ho-chi-minh-city': { lang: 'en', pair: 'thue-xe-may-tphcm' },
  'thue-xe-may-tphcm': { lang: 'vi', pair: 'motorbike-rental-ho-chi-minh-city' },
}

/* ── the `/vi` pilot (SEO wave B: V3a merged switched off, V5 switches it on, decision V-h) ──────── */

/**
 * ⛔ THE PATHS WITH A PUBLIC `/vi` TWIN — SWITCHED ON BY V5 (decisions V-a, V-b, V-h; owner's go 2026-10-02).
 *
 * The owner's decision (2026-09-27, V-a): on a piloted path the PLAIN URL is always English, whatever the
 * cookie or Accept-Language says, and `/vi` + the path is its Vietnamese twin. No language redirect: a
 * Vietnamese visitor on the plain URL gets a one-tap banner to the twin (lang-suggestion-banner.tsx, V3b).
 * Both URLs are self-canonical with reciprocal hreflang (V3b), and `/vi` is in no sitemap (V-c) — since phase 1
 * (2026-11-19) that holds for `/` only: `/c/furniture-appliances` is a category, and the sitemap submits every
 * category with a twin as a plain + `/vi` pair (src/lib/sitemap.ts `langUrlEntries`).
 * The marketplace edition only (`viPilotFor`).
 * ⛔ THREE PLACES MOVE TOGETHER, NEVER ONE WITHOUT THE OTHERS (plan §5): this list; the edge Worker's
 * `PINNED_EN_PATHS` (infra/cloudflare/eno-html-edge-cache.js — edge-worker.test.ts fails unless the two
 * are equal), deployed with the `/vi` and `/vi/*` routes on the eno.vn zone; and eno-deploy.sh's
 * language probes (`PILOT_EXPECT`). Withdrawing a path is rollback V-R: it MOVES to `VI_RETIRED_PATHS`
 * (its `/vi…` URL may be indexed, so it 308s), it is never just deleted.
 * ⚠️ EMPTY, NOTHING CHANGES ANYWHERE: `pinnedRoute` falls through to the guides, a public `/vi…` 404s
 * through the proxy's INTERNAL_PREFIX rule, and every helper below returns its input
 * (lang-pinned.test.ts runs every function lists-off, on and retired).
 */
export const VI_PREFIX_PATHS: readonly string[] = ['/', '/c/furniture-appliances']

/**
 * ⛔ PATHS THAT WERE PILOTED AND WITHDRAWN (rollback V-R): their `/vi…` URL may be indexed, so it answers
 * a 308 to the plain path — never a 404 (plan §5). Empty while the pilot has never been on.
 */
export const VI_RETIRED_PATHS: readonly string[] = []

/** One URL segment as these routes spell it: lowercase ASCII words joined by single hyphens (a cuid is one word). */
const SEG = '[a-z0-9]+(?:-[a-z0-9]+)*'

/**
 * ⛔ THE PHASE-1 `/vi` FAMILIES (owner, 2026-11-19 — phase 1 of the Vietnamese-URL plan): `/vi` + a path
 * matching one of these renders that page's Vietnamese variant for everyone, at the plain path's own `vi` ISR
 * entry (the same HTML, the same purge). UNLIKE THE PILOT LIST ABOVE, THE PLAIN URL KEEPS NEGOTIATING (cookie,
 * then Accept-Language): a family is not V-a, so pinnedRoute returns null for its plain path and the edge
 * Worker, which only pins `PINNED_EN_PATHS`, needs no change. Canonical and hreflang follow the language the
 * page RENDERED (a Vietnamese render of plain `/c/x` declares `/vi/c/x`) — that is the metadata's job, built on
 * `hasViTwin` / `viTwinPath`.
 * ⛔ EXACT, ANCHORED PATTERNS, CHECKED AGAINST THE ROUTE TREE (src/app/[lang]): a category, a category in one
 * district (`c/[category]/(index)` and `c/[category]/[district]`), the help centre and one answer (`help`,
 * `help/[id]` — a cuid or a seeded slug), the schools directory, one school, the awards redirect and one
 * year (`schools`, `schools/[slug]`, `schools/awards`, `schools/awards/[year]`). NEVER AN APP OR FORM PAGE:
 * `/schools/suggest` (the form, a static route beside `[slug]`) is excluded by name, and the anchors keep out
 * `/schools/<slug>/review`, `/help/<id>/…`, `/c/<cat>/<district>/…` and `/c` itself (lang-pinned.test.ts
 * walks the real route tree). Listings, sellers, shop hosts, the teacher host and the guides (which have
 * their own Vietnamese slugs) are NOT here — phase 2, per row, if ever.
 * ⚠️ A LITERAL LIST for the proxy bundle (see the top of this file), marketplace only (`viPilotFor`).
 * Withdrawing a family is rollback V-R as for the pilot: MOVE its pattern to `VI_RETIRED_FAMILIES` (its
 * `/vi…` URLs may be indexed, so they 308 to the plain path), never just delete it — and the deploy probe's
 * `FAMILIES_EXPECT` (infra/vn-node/eno-deploy.sh) moves with it.
 */
export const VI_TWIN_FAMILIES: readonly RegExp[] = [
  // Not the teachers category: it belongs to the teacher host (teacher.eno.vn), which phase 1 leaves out.
  new RegExp(`^/c/(?!teachers(?:/|$))${SEG}$`),
  new RegExp(`^/c/(?!teachers/)${SEG}/${SEG}$`),
  /^\/help$/,
  new RegExp(`^/help/${SEG}$`),
  /^\/schools$/,
  new RegExp(`^/schools/(?!suggest$)${SEG}$`),
  /^\/schools\/awards\/\d{4}$/,
  // The HCMC rent index (owner, 2026-11-19): its Vietnamese render is complete, and Vietnamese press pitches link it.
  /^\/hcmc-rent-index$/,
  // The four rent tools (2026-11-23, src/lib/rent-tools/registry.ts): authored in both languages. lang-pinned.test.ts
  // holds this literal equal to RENT_TOOL_SLUGS.
  /^\/(?:rent-affordability-calculator|move-in-cost-calculator|rental-cost-comparison|vietnamese-price-converter)$/,
  // The tools hub and the tools eno Reach writes (2026-11-23, src/lib/tools/registry.ts): every word authored in both languages.
  new RegExp(`^/tools(?:/${SEG})?$`),
]

/** Families that were live and are withdrawn (rollback V-R): their `/vi…` answers a 308 to the plain path. */
export const VI_RETIRED_FAMILIES: readonly RegExp[] = []

/**
 * The lists, passed as a parameter so the pure functions can be tested on, off and retired. `families` /
 * `retiredFamilies` are optional: a `{live, retired}` value is the pilot alone, as before phase 1.
 */
export type ViPilot = {
  readonly live: readonly string[]
  readonly retired: readonly string[]
  readonly families?: readonly RegExp[]
  readonly retiredFamilies?: readonly RegExp[]
}

/**
 * The lists this build uses. ⛔ eno.forum NEVER PILOTS (V3a): its `/vi` stays a 404 and its plain
 * URLs keep negotiating, whatever the constants above hold.
 */
export function viPilotFor(
  isServices: boolean,
  live: readonly string[],
  retired: readonly string[],
  families: readonly RegExp[] = [],
  retiredFamilies: readonly RegExp[] = [],
): ViPilot {
  return isServices ? { live: [], retired: [], families: [], retiredFamilies: [] } : { live, retired, families, retiredFamilies }
}
/**
 * The marketplace's lists whatever edition this build is. ⚠️ FOR TESTS: vitest runs as the services edition
 * (vitest.config.ts), where `VI_PILOT` is empty — pass this to see what eno.vn does.
 */
export const VI_PILOT_MARKETPLACE: ViPilot = viPilotFor(false, VI_PREFIX_PATHS, VI_RETIRED_PATHS, VI_TWIN_FAMILIES, VI_RETIRED_FAMILIES)
export const VI_PILOT: ViPilot = viPilotFor(IS_SERVICES, VI_PREFIX_PATHS, VI_RETIRED_PATHS, VI_TWIN_FAMILIES, VI_RETIRED_FAMILIES)

const matches = (path: string, patterns: readonly RegExp[] | undefined) => !!patterns?.some((re) => re.test(path))

/**
 * ⛔ DOES THIS PUBLIC PLAIN PATH HAVE A `/vi` TWIN? A pilot path (`/`, `/c/furniture-appliances`) or a path in a
 * phase-1 family. A `/vi…` path is not a plain path and answers false; so does anything with a query or hash —
 * pass the pathname. The one test the head (canonical, hreflang), the sitemap and the links all ask, so they
 * cannot disagree. ⚠️ It says nothing about robots: a noindex page has a twin but must not advertise it.
 */
export function hasViTwin(pathname: string, lists: ViPilot = VI_PILOT): boolean {
  return lists.live.includes(pathname) || matches(pathname, lists.families)
}

/** A `/vi…` twin that was withdrawn (rollback V-R): it 308s to the plain path. */
const isRetiredTwin = (plain: string, lists: ViPilot) => lists.retired.includes(plain) || matches(plain, lists.retiredFamilies)

/** `/vi`, `/vi/c/x` → the plain path (`/`, `/c/x`); anything else → null. Says nothing about the lists. */
function viPrefixed(pathname: string): string | null {
  if (pathname === '/vi') return '/'
  // `/vi/` is not `/vi` (exact match, as for the guides): Next strips the slash before the proxy runs.
  return pathname.startsWith('/vi/') && pathname.length > 4 ? pathname.slice(3) : null
}

/**
 * The public `/vi` twin of a plain path: `/` → `/vi`, `/c/x` → `/vi/c/x`. Pure string work — ask `hasViTwin`
 * first; a path without a twin gets a `/vi…` that 404s.
 */
export function viTwinPath(pathname: string): string {
  return pathname === '/' ? '/vi' : `/vi${pathname}`
}
const viTwin = viTwinPath

/** What the proxy does with a path: render a fixed variant (at the internal path), 308, or negotiate (null). */
export type PinnedRoute = { variant: LangVariant; internalPath: string } | { redirect: string }

/**
 * The fixed variant of a public path, with the internal path the proxy rewrites it to; a `{redirect}` for
 * a withdrawn pilot path; or `null` for a path that negotiates.
 *
 * - `/vi` + a live pilot path or a phase-1 family path (`hasViTwin`) → `vi`, rendered at the PLAIN path (the
 *   proxy prefixes the variant, so it is the same ISR entry, and the same purge, as the plain path's `vi`
 *   variant — revalidatePublicPath).
 * - `/vi` + a retired path or retired family → `{redirect: plain}` (the proxy answers 308, query kept).
 * - any other `/vi…` → null: the proxy's INTERNAL_PREFIX rule 404s it, as before the pilot.
 * - a plain live pilot path → `en`, for everyone (V-a). A plain FAMILY path → null: it negotiates.
 * - a guide → its article's language (V1).
 *
 * ⚠️ EXACT MATCH ON THE PATH. A trailing slash, a sub-path or a different case is not the guide (Next
 * redirects the slash away before this runs, and the others are 404s either way).
 * ⚠️ `Object.hasOwn`, NOT `FIXED_LANG[slug]`: a path of `/constructor` or `/__proto__` must not read
 * the prototype and come back "pinned".
 */
export function pinnedRoute(pathname: string, lists: ViPilot = VI_PILOT): PinnedRoute | null {
  if (!pathname.startsWith('/')) return null
  const plain = viPrefixed(pathname)
  if (plain !== null) {
    if (hasViTwin(plain, lists)) return { variant: 'vi', internalPath: plain }
    if (isRetiredTwin(plain, lists)) return { redirect: plain }
    return null
  }
  if (lists.live.includes(pathname)) return { variant: 'en', internalPath: pathname }
  // The general guide library (src/lib/guides): the address says the language, so no list comes with it.
  if (/^\/guides(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?$/.test(pathname)) return { variant: 'en', internalPath: pathname }
  if (/^\/huong-dan(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?$/.test(pathname)) return { variant: 'vi', internalPath: pathname }
  // A model price page (src/lib/model-pages.ts): /gia/<slug> is Vietnamese, /price/<slug> English — and each address's hub
  // (2026-11-27, the list of model pages): /gia Vietnamese, /price English.
  if (/^\/gia(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?$/.test(pathname)) return { variant: 'vi', internalPath: pathname }
  if (/^\/price(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?$/.test(pathname)) return { variant: 'en', internalPath: pathname }
  const slug = pathname.slice(1)
  if (!slug || !Object.hasOwn(FIXED_LANG, slug)) return null
  return { variant: FIXED_LANG[slug].lang, internalPath: pathname }
}

/** The variant a path is pinned to, or null (a negotiating path, or a pilot redirect). */
export function pinnedVariant(pathname: string, lists: ViPilot = VI_PILOT): LangVariant | null {
  const r = pinnedRoute(pathname, lists)
  return r && 'variant' in r ? r.variant : null
}

/**
 * The public path of a pinned page's other language, or `null` when it is not pinned or has none: a
 * guide's translation, or a pilot path's twin (`/` ↔ `/vi`). A family's `/vi…` twin is pinned (→ its plain
 * path); a family's plain path is not (it negotiates) → null — language-context.tsx sends a Vietnamese choice
 * there to `viTwinPath` itself.
 */
export function pinnedPair(pathname: string, lists: ViPilot = VI_PILOT): string | null {
  const plain = viPrefixed(pathname)
  if (plain !== null) return hasViTwin(plain, lists) ? plain : null
  if (lists.live.includes(pathname)) return viTwin(pathname)
  if (!pinnedVariant(pathname, lists)) return null
  // A model price page's twin is the same slug at the other language's address; the hub's is the other hub.
  const model = /^\/(gia|price)(\/.+)?$/.exec(pathname)
  if (model) return `/${model[1] === 'gia' ? 'price' : 'gia'}${model[2] ?? ''}`
  // A library guide is pinned by its address, not by this list. Its other language, if it has one, is in the article's own hreflang.
  if (!Object.hasOwn(FIXED_LANG, pathname.slice(1))) return null
  const pair = FIXED_LANG[pathname.slice(1)].pair
  return pair ? `/${pair}` : null
}

/**
 * The path an app-chrome check should compare against: `/vi…` of a live twin (pilot or family) → its plain path, so
 * the mobile nav's Explore tab is active on `/vi` and a search from `/vi/c/x` keeps category `x`
 * (mobile-nav.tsx, explorer-presence.ts). Anything else is returned as it is.
 */
export function stripViPrefix<T extends string | null | undefined>(pathname: T, lists: ViPilot = VI_PILOT): T | string {
  if (!pathname) return pathname
  const plain = viPrefixed(pathname)
  return plain !== null && hasViTwin(plain, lists) ? plain : pathname
}

/**
 * Where a link to `href` should point on a page rendered in `variant`: the `/vi` twin when the page is
 * Vietnamese and the target has one (`hasViTwin`: a pilot path or a phase-1 family), so a Vietnamese reading
 * never links into the English-pinned plain URL (V3b) and a family's Vietnamese page links (and redirects) to
 * Vietnamese addresses. Query and hash ride along. Anything else — an English page, a target without a twin,
 * an absolute or protocol-relative URL — is returned unchanged, so with the lists empty this is the identity.
 * ⛔ It never produces a `/vi` path that does not render (lang-pinned.test.ts).
 */
export function localizedHref(href: string, variant: string, lists: ViPilot = VI_PILOT): string {
  if (variant !== 'vi' || !href.startsWith('/') || href.startsWith('//')) return href
  const cut = href.search(/[?#]/)
  const path = cut === -1 ? href : href.slice(0, cut)
  return hasViTwin(path, lists) ? viTwin(path) + (cut === -1 ? '' : href.slice(cut)) : href
}

/**
 * Does the `/vi` pilot exist on this HOST? Not on a storefront's own host (`<label>.<apex>`): src/proxy.ts
 * pins nothing there — its `/` is the shop — and only sends a live `/vi` twin on to the apex with a 308
 * (proxy.vi-pilot.test.ts). The apex, its `www`, localhost and any unrelated host keep it. ⚠️ FOR
 * CALL-TIME CHECKS IN HANDLERS ONLY (header.tsx): cached HTML is shared by every host, so a rendered
 * href cannot ask this — the proxy's 308 is what catches those.
 */
export function pilotOnHost(hostname: string, appUrl: string | null | undefined): boolean {
  let apex = ''
  try { apex = new URL(appUrl ?? '').hostname.replace(/^www\./, '') } catch { return true }
  const host = hostname.toLowerCase()
  return !apex || host === apex || host === `www.${apex}` || !host.endsWith(`.${apex}`)
}

/**
 * The variant a HANDLER should navigate with when it means to STAY IN THE SHOP: `variant`, except on a host
 * without the pilot (a shop's host — pilotOnHost), where a `/vi…` target would bounce to the apex and out
 * of the shop, while the plain URL stays on the shop's host in the reader's own language (a shop's host
 * negotiates every path, and its `/` is the shop's own explorer). The header's search, brand, map and area
 * and a grid's "show on map" use it. ⚠️ A STORED, MARKETPLACE-WIDE link (a saved search, an alert) must
 * NOT: it keeps the twin, and the proxy's bounce to the apex is exactly where it belongs (hrefHere).
 * Reads `location`, so call it at click time, never while rendering (see pilotOnHost).
 */
export function hereVariant(variant: string): string {
  if (typeof window === 'undefined') return variant
  return pilotOnHost(window.location.hostname, process.env.NEXT_PUBLIC_APP_URL) ? variant : 'en'
}

/**
 * A STORED `/vi…` link opened in a build without that twin — eno.forum, which has no pilot (its `/vi` is a
 * 404) — back to the plain URL, the same page there. The saved-search cron runs on eno.vn and writes
 * `/vi?…` for a Vietnamese recipient (A1-LANG), but the notification row is in the database both editions
 * share. public/sw.js applies the same rule to a push's URL.
 * ⚠️ A SHOP'S HOST KEEPS THE TWIN, unlike a handler's hereVariant: src/proxy.ts sends a live twin asked of
 * a shop's host on to the apex, which is where a marketplace-wide saved search belongs — the plain `/?…`
 * there would be that one shop's own explorer. Anything that is not a `/vi…` twin is returned as it is.
 */
export function hrefHere(href: string, lists: ViPilot = VI_PILOT): string {
  const cut = href.search(/[?#]/)
  const plain = viPrefixed(cut === -1 ? href : href.slice(0, cut))
  if (plain === null || hasViTwin(plain, lists)) return href
  return plain + (cut === -1 ? '' : href.slice(cut))
}

/**
 * The head of a pilot page (V3b, decision V-g): its canonical and the reciprocal alternates — the plain URL
 * for `en` and `x-default`, the `/vi` twin for `vi-VN` — or `null` when `plain` is not a live pilot path,
 * in which case the page emits exactly what it did before the pilot. `origin` has no trailing slash.
 * ⚠️ PILOT PATHS ONLY, DELIBERATELY, AND NO PAGE CALLS IT ANY MORE: every twin page's head (pilot and phase-1
 * families, robots-aware — no alternates on a noindex page) is `langAlternatesFor` (src/lib/lang-alternates.ts),
 * which gives the pilot paths exactly this function's output (lang-alternates.test.ts holds the parity).
 */
export function langAlternates(
  plain: string,
  variant: string,
  origin: string,
  lists: ViPilot = VI_PILOT,
): { canonical: string; languages: Record<'en' | 'vi-VN' | 'x-default', string> } | null {
  if (!lists.live.includes(plain)) return null
  // The root WITH its slash, as langAlternatesFor (Seobility, 2026-11-23: the bare origin is a redirect).
  const at = (p: string) => `${origin.replace(/\/+$/, '')}${p}`
  const en = at(plain)
  const vi = at(viTwin(plain))
  return { canonical: variant === 'vi' ? vi : en, languages: { en, 'vi-VN': vi, 'x-default': en } }
}
