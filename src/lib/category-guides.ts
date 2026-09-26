import { MARKETPLACE_GUIDES, expatGuidePath } from './expat-guides'
import { PHONE_GUIDES, phoneGuideCategories } from './phone-guides'

/**
 * THE "GUIDES" BLOCK ON A CATEGORY PAGE — which long-form guides `/c/<category>` links to.
 *
 * ⛔ THE ~45 GUIDES HAD NO LINK FROM ANY HUB. Measured 2026-09-27: nothing on `/`, `/about`, any
 * `/c/*` page or any landing pointed at one; each was reachable only from the sitemap and its own
 * siblings' "Keep reading". The category page is where a reader of that inventory is, so the link
 * goes there — driven by the registries' `categories` field, never a list typed into the page.
 *
 * ⚠️ BOTH REGISTRIES ARE MARKETPLACE ROUTES (`page.tsx`) — `EXPAT_GUIDES` is not read here, because
 * those are forum-only and would be 404s on eno.vn. The test pins that every guide this returns has
 * a `page.tsx`.
 *
 * ⚠️ SAME LANGUAGE, OR ENGLISH — NEVER A MIX. The page's language picks the guides; a language with
 * none for this category falls back to the English ones (the rentals guides are English-only today).
 * A list is never half one language and half the other, and the link text is always the guide's own
 * `label` in the guide's own language — the caller marks it with `lang` so a reader and a screen
 * reader both know.
 */

export type CategoryGuide = { href: string; label: string; blurb: string; lang: 'en' | 'vi' }

/** At most this many — a block of links, not a second index page. */
export const CATEGORY_GUIDE_LIMIT = 4

type Entry = { slug: string; lang: 'en' | 'vi'; label: string; blurb: string; categories: readonly string[] }

const ENTRIES: readonly Entry[] = [
  ...MARKETPLACE_GUIDES.map((g) => ({ slug: g.slug, lang: g.lang ?? ('en' as const), label: g.label, blurb: g.blurb, categories: g.categories ?? [] })),
  ...PHONE_GUIDES.map((g) => ({ slug: g.slug, lang: g.lang, label: g.label, blurb: g.blurb, categories: phoneGuideCategories(g) })),
]

/**
 * Up to `limit` guides for `category` in `lang`, falling back to English.
 *
 * ⚠️ RANKED BY WHERE THE CATEGORY SITS IN EACH GUIDE'S `categories`, then registry order: a guide
 * written FOR rentals (renting, deposit) comes before one that merely also fits it (furnishing).
 */
export function guidesForCategory(category: string, lang: 'en' | 'vi', limit = CATEGORY_GUIDE_LIMIT): CategoryGuide[] {
  const on = ENTRIES.map((g, i) => ({ g, i, rank: g.categories.indexOf(category) })).filter((x) => x.rank >= 0)
  const inLang = (l: 'en' | 'vi') =>
    on.filter((x) => x.g.lang === l).sort((a, b) => a.rank - b.rank || a.i - b.i).slice(0, Math.max(0, limit))
  const own = inLang(lang)
  return (own.length ? own : inLang('en')).map(({ g }) => ({ href: expatGuidePath(g.slug), label: g.label, blurb: g.blurb, lang: g.lang }))
}
