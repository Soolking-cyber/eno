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

/* ── the `/vi` pilot (SEO wave B, V3a — merged switched off, decision V-h) ────────────────────────── */

/**
 * ⛔ THE PATHS WITH A PUBLIC `/vi` TWIN — EMPTY UNTIL V5 SWITCHES THE PILOT ON (decisions V-a, V-h).
 *
 * The owner's decision (2026-09-27, V-a): on a piloted path the PLAIN URL is always English, whatever the
 * cookie or Accept-Language says, and `/vi` + the path is its Vietnamese twin. No language redirect: a
 * Vietnamese visitor on the plain URL gets a one-tap banner to the twin (lang-suggestion-banner.tsx, V3b).
 * Both URLs are self-canonical with reciprocal hreflang (V3b). V5 fills this with `/` and
 * `/c/furniture-appliances`, on the marketplace edition only, together with the Worker's
 * `PINNED_EN_PATHS` and the deploy probes — never one without the others (plan §5).
 * ⛔ WHILE IT IS EMPTY NOTHING CHANGES ANYWHERE: `pinnedRoute` falls through to the guides, a public
 * `/vi…` keeps 404ing through the proxy's INTERNAL_PREFIX rule, and every helper below returns its
 * input. That is the dormancy the merge relies on (lang-pinned.test.ts runs every function lists-off).
 */
export const VI_PREFIX_PATHS: readonly string[] = []

/**
 * ⛔ PATHS THAT WERE PILOTED AND WITHDRAWN (rollback V-R): their `/vi…` URL may be indexed, so it answers
 * a 308 to the plain path — never a 404 (plan §5). Empty while the pilot has never been on.
 */
export const VI_RETIRED_PATHS: readonly string[] = []

/** The two lists, passed as a parameter so the pure functions can be tested on, off and retired. */
export type ViPilot = { readonly live: readonly string[]; readonly retired: readonly string[] }

/**
 * The lists this build uses. ⛔ eno.forum NEVER PILOTS (V3a): its `/vi` stays a 404 and its plain
 * URLs keep negotiating, whatever the constants above hold.
 */
export function viPilotFor(isServices: boolean, live: readonly string[], retired: readonly string[]): ViPilot {
  return isServices ? { live: [], retired: [] } : { live, retired }
}
export const VI_PILOT: ViPilot = viPilotFor(IS_SERVICES, VI_PREFIX_PATHS, VI_RETIRED_PATHS)

/** `/vi`, `/vi/c/x` → the plain path (`/`, `/c/x`); anything else → null. Says nothing about the lists. */
function viPrefixed(pathname: string): string | null {
  if (pathname === '/vi') return '/'
  // `/vi/` is not `/vi` (exact match, as for the guides): Next strips the slash before the proxy runs.
  return pathname.startsWith('/vi/') && pathname.length > 4 ? pathname.slice(3) : null
}

/** The public `/vi` twin of a plain path: `/` → `/vi`, `/c/x` → `/vi/c/x`. */
const viTwin = (plain: string): string => (plain === '/' ? '/vi' : `/vi${plain}`)

/** What the proxy does with a path: render a fixed variant (at the internal path), 308, or negotiate (null). */
export type PinnedRoute = { variant: LangVariant; internalPath: string } | { redirect: string }

/**
 * The fixed variant of a public path, with the internal path the proxy rewrites it to; a `{redirect}` for
 * a withdrawn pilot path; or `null` for a path that negotiates.
 *
 * - `/vi` + a live pilot path → `vi`, rendered at the PLAIN path (the proxy prefixes the variant, so it
 *   is the same ISR entry, and the same purge, as the plain path's `vi` variant — revalidatePublicPath).
 * - `/vi` + a retired path → `{redirect: plain}` (the proxy answers 308, query kept).
 * - any other `/vi…` → null: the proxy's INTERNAL_PREFIX rule 404s it, as before the pilot.
 * - a plain live pilot path → `en`, for everyone (V-a).
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
    if (lists.live.includes(plain)) return { variant: 'vi', internalPath: plain }
    if (lists.retired.includes(plain)) return { redirect: plain }
    return null
  }
  if (lists.live.includes(pathname)) return { variant: 'en', internalPath: pathname }
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
 * guide's translation, or a pilot path's twin (`/` ↔ `/vi`).
 */
export function pinnedPair(pathname: string, lists: ViPilot = VI_PILOT): string | null {
  const plain = viPrefixed(pathname)
  if (plain !== null) return lists.live.includes(plain) ? plain : null
  if (lists.live.includes(pathname)) return viTwin(pathname)
  if (!pinnedVariant(pathname, lists)) return null
  const pair = FIXED_LANG[pathname.slice(1)].pair
  return pair ? `/${pair}` : null
}

/**
 * The path an app-chrome check should compare against: `/vi…` of a live pilot path → its plain path, so
 * the mobile nav's Explore tab is active on `/vi` and a search from `/vi/c/x` keeps category `x`
 * (mobile-nav.tsx, explorer-presence.ts). Anything else is returned as it is.
 */
export function stripViPrefix<T extends string | null | undefined>(pathname: T, lists: ViPilot = VI_PILOT): T | string {
  if (!pathname) return pathname
  const plain = viPrefixed(pathname)
  return plain !== null && lists.live.includes(plain) ? plain : pathname
}

/**
 * Where a link to `href` should point on a page rendered in `variant`: the `/vi` twin when the page is
 * Vietnamese and the target is a live pilot path, so a Vietnamese reading never links into the
 * English-pinned plain URL (V3b). Query and hash ride along. Anything else — an English page, a target
 * outside the list, an absolute or protocol-relative URL — is returned unchanged, so with the lists
 * empty this is the identity. ⛔ It never produces a `/vi` path outside the live list (lang-pinned.test.ts).
 */
export function localizedHref(href: string, variant: string, lists: ViPilot = VI_PILOT): string {
  if (variant !== 'vi' || !href.startsWith('/') || href.startsWith('//')) return href
  const cut = href.search(/[?#]/)
  const path = cut === -1 ? href : href.slice(0, cut)
  return lists.live.includes(path) ? viTwin(path) + (cut === -1 ? '' : href.slice(cut)) : href
}

/**
 * The head of a pilot page (V3b, decision V-g): its canonical and the reciprocal alternates — the plain URL
 * for `en` and `x-default`, the `/vi` twin for `vi-VN` — or `null` when `plain` is not a live pilot path,
 * in which case the page emits exactly what it did before the pilot. `origin` has no trailing slash.
 */
export function langAlternates(
  plain: string,
  variant: string,
  origin: string,
  lists: ViPilot = VI_PILOT,
): { canonical: string; languages: Record<'en' | 'vi-VN' | 'x-default', string> } | null {
  if (!lists.live.includes(plain)) return null
  const at = (p: string) => (p === '/' ? origin : `${origin}${p}`)
  const en = at(plain)
  const vi = at(viTwin(plain))
  return { canonical: variant === 'vi' ? vi : en, languages: { en, 'vi-VN': vi, 'x-default': en } }
}
