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

/**
 * The fixed variant of a public path, with the internal path the proxy rewrites it to — or `null` for
 * a path that negotiates. `internalPath` is the public path itself: pinning changes WHICH variant
 * renders, never where.
 *
 * ⚠️ EXACT MATCH ON THE PATH. A trailing slash, a sub-path or a different case is not the guide (Next
 * redirects the slash away before this runs, and the others are 404s either way).
 * ⚠️ `Object.hasOwn`, NOT `FIXED_LANG[slug]`: a path of `/constructor` or `/__proto__` must not read
 * the prototype and come back "pinned".
 */
export function pinnedRoute(pathname: string): { variant: LangVariant; internalPath: string } | null {
  if (!pathname.startsWith('/')) return null
  const slug = pathname.slice(1)
  if (!slug || !Object.hasOwn(FIXED_LANG, slug)) return null
  return { variant: FIXED_LANG[slug].lang, internalPath: pathname }
}

/** The public path of a pinned guide's translation, or `null` when it is not pinned or has no pair. */
export function pinnedPair(pathname: string): string | null {
  const slug = pathname.slice(1)
  if (!pinnedRoute(pathname)) return null
  const pair = FIXED_LANG[slug].pair
  return pair ? `/${pair}` : null
}
