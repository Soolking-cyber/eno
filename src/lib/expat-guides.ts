import { PHONE_GUIDES } from './phone-guides'

/**
 * THE LONG-FORM ARRIVAL GUIDES — one registry, so a new one cannot be built and then forgotten.
 *
 * Same idiom, and the same reason, as src/lib/vietnam-evisa/links.ts: the sitemap's static page list
 * is hard-coded, which is exactly how a page ships, deploys, and is never submitted to Google. The
 * sitemap imports `EXPAT_GUIDE_PATHS` from here, so adding an entry adds the URL to the sitemap and
 * to every sibling guide's "Keep reading" block at once. It does not create the route — but a listed
 * path with no page is a 404 in the sitemap, which is loud, while a live page in no sitemap is
 * silent. Loud is the failure mode to choose.
 *
 * ⚠️ THE ROUTES ARE SERVICES-ONLY (`page.svc.tsx`) AND THIS MODULE IS NOT. That asymmetry is
 * deliberate and it constrains what may be written here: src/app/sitemap.xml/route.ts compiles on
 * BOTH editions, so every string below lands in eno.vn's server bundle even though the pages do not
 * exist there. Hence the rule for this file —
 *
 *   ⚠️ NO VISA VOCABULARY IN ANY VALUE. Not in a slug, not in a label, not in a blurb. The guides
 *   themselves discuss the e-visa at length; those words live in the `page.svc.tsx` files, which a
 *   marketplace build never compiles. Keeping this registry vocabulary-free is what lets the sitemap
 *   import it without an alias, and it is a rule you can check by reading three lines rather than by
 *   reasoning about a module graph.
 *
 * ⚠️ AND THE SITEMAP MUST STILL GATE ON IS_SERVICES. The paths are harmless words; submitting them
 * to Google from eno.vn would submit four 404s. The gate is in the sitemap, beside the e-visa one.
 */
export type ExpatGuide = {
  /** Top-level route segment. */
  slug: string
  /**
   * ISO date (YYYY-MM-DD) the guide first went live — `datePublished` in its Article JSON-LD.
   *
   * ⛔ THE DATES LIVE HERE, NOT IN THE PAGE FILE. Each page spreads `...guideDates(SLUG)` into its
   * content (seo-article.tsx turns `updated ?? published` into `dateModified`), and a registry entry
   * is something the sitemap can import for the guide's `<lastmod>` — which a date typed into a page
   * file never was. One copy means the page and the sitemap cannot tell Google different dates.
   */
  published: string
  /**
   * ISO date of the last edit a READER would notice — new or rewritten prose, a changed link. Not a
   * comment, not a refactor, not a regenerated string. Omitted until the first such edit, and then
   * `dateModified` falls back to `published`, which is the truth for an untouched guide.
   */
  updated?: string
  /** Link text used by sibling guides. */
  label: string
  /** One line of what the guide answers — the link's whole reason to be clicked. */
  blurb: string
  /**
   * The language this guide is WRITTEN in. Optional: the two original marketplace guides are
   * English-only and have no counterpart, and forcing a `lang` on them would imply a pair exists.
   *
   * ⛔ IT IS NOT DECORATION — IT IS HALF OF THE ONLY WAY VIETNAMESE CONTENT CAN RANK HERE.
   * src/proxy.ts serves BOTH languages at ONE url (a public /vi/... 404s), so Googlebot — which
   * crawls predominantly as `en` — only ever sees the English rendering of a shared page. A
   * Vietnamese article is therefore invisible unless it has its OWN slug, which is exactly what
   * the 18 phone-guide pairs do. Measured 2026-09-23: the only Vietnamese URLs Google has any
   * impressions for are those distinctly-slugged ones.
   */
  lang?: 'en' | 'vi'
  /**
   * The slug of the same guide in the other language.
   *
   * ⚠️ RECIPROCAL OR IGNORED. Google discards a one-way hreflang pair outright, which is why both
   * sides read from `marketplaceGuideAlternates()` rather than hand-writing `alternates` in each
   * page file — a registry can be checked; two hand-written objects drift.
   */
  pair?: string
  /**
   * The `/c/<category>` pages this guide is written for, PRIMARY FIRST — the "Guides" block on a
   * category page reads it through `guidesForCategory()` (src/lib/category-guides.ts), which ranks a
   * guide higher on the category it names first. Optional: a guide that answers no category's
   * question (posting for free) is simply on none.
   *
   * ⚠️ ONLY A CATEGORY WHOSE STOCK THE GUIDE ACTUALLY DESCRIBES. A guide that frames used goods as
   * expats' moving sales must not sit on a category whose used stock is dealer-supplied.
   */
  categories?: readonly string[]
}

export const EXPAT_GUIDES: readonly ExpatGuide[] = [
  {
    slug: 'moving-to-vietnam',
    published: '2026-08-01',
    updated: '2026-09-27',
    label: 'Moving to Vietnam: what to arrange before you fly',
    blurb:
      'The paperwork that has to be done at home, what to ship and what to buy secondhand, and how much cash the first month really takes.',
  },
  {
    slug: 'first-month-in-vietnam',
    published: '2026-08-01',
    updated: '2026-09-27',
    label: 'Your first month in Vietnam: the checklist',
    blurb:
      'Registering your stay, a phone number that works with banking apps, reading a lease, and the deadlines that have real consequences.',
  },
] as const

/**
 * THE MARKETPLACE'S OWN GUIDES — a separate list, because the two above cannot be shared.
 *
 * ⛔ WHY NOT JUST UN-GATE THE SERVICES GUIDES: their BODIES are about the e-visa at length (they import
 * `@/lib/visa-provider` and link the e-visa hub), so they are `page.forum.svc.tsx` and a marketplace
 * build never compiles them. That left the licensed marketplace with no long-form expat content at all
 * — someone searching "moving to Vietnam" landed on the services site instead of the shop. These two
 * are written from scratch for eno.vn's own subject: furnishing a home here, and selling it again when
 * you leave. Both are ordinary `page.tsx` routes, so they exist on BOTH editions and each self-
 * canonicalises to its own origin, exactly as the five landing pages already do.
 *
 * ⚠️ THE SAME VOCABULARY RULE APPLIES HERE AND IT IS WIDER THAN IT LOOKS: no visa, no itinerary AND no
 * PayPal in any value — the third is the one a reviewer had to point out, because the licensing note
 * everyone quotes lists all three (astra).
 */
export const MARKETPLACE_GUIDES: readonly ExpatGuide[] = [
  {
    slug: 'furnishing-a-home-in-vietnam',
    published: '2026-09-16',
    updated: '2026-09-27',
    categories: ['furniture-appliances', 'rentals'],
    label: 'Furnishing a home in Vietnam without overpaying',
    blurb:
      'What to buy new, what to buy used, what the landlord should already provide — and how to check a secondhand piece before money moves.',
  },
  {
    slug: 'selling-up-before-you-leave-vietnam',
    published: '2026-09-16',
    updated: '2026-09-27',
    categories: ['furniture-appliances'],
    label: 'Selling up before you leave Vietnam',
    blurb:
      'Start six weeks out, price against what is actually listed, and hand over in a way that does not cost you the deposit.',
  },


  /* ── The 2026-09-23 inventory-backed cluster ────────────────────────────────────────────────
   * Each of these is backed by stock that EXISTS — 3,201 used furniture/appliance listings and
   * 19,359 HCMC rentals, measured the day they were written. That is the whole selection rule:
   * the motorbike cluster has stronger demand and was deliberately NOT written, because `vehicles`
   * holds zero motorbikes and every article would rank into an empty rail.
   *
   * ⚠️ THE VIETNAMESE ONES CARRY THEIR OWN SLUG BECAUSE THAT IS THE ONLY WAY THEY CAN RANK.
   * src/proxy.ts serves both languages at ONE url and a public /vi/… 404s, so Googlebot — which
   * crawls predominantly as `en` — never sees a shared page's Vietnamese rendering. Measured
   * 2026-09-23: the only Vietnamese URLs with any impressions are distinctly-slugged ones.
   */
  {
    slug: 'secondhand-furniture-ho-chi-minh-city',
    published: '2026-09-23',
    updated: '2026-09-27',
    lang: 'en',
    pair: 'thanh-ly-do-gia-dung-cu-tphcm',
    categories: ['furniture-appliances'],
    label: 'Buying secondhand furniture in Ho Chi Minh City',
    blurb:
      'What a used sofa, wardrobe or air conditioner actually costs here, and what to test before any money moves.',
  },
  {
    slug: 'thanh-ly-do-gia-dung-cu-tphcm',
    published: '2026-09-23',
    updated: '2026-09-27',
    lang: 'vi',
    pair: 'secondhand-furniture-ho-chi-minh-city',
    categories: ['furniture-appliances'],
    label: 'Thanh lý đồ gia dụng cũ tại TP.HCM',
    blurb:
      'Khoảng giá thật theo từng món, cách kiểm tra máy lạnh và máy giặt cũ, và vì sao bán xô luôn mất giá.',
  },
  {
    slug: 'do-cu-cua-nguoi-nuoc-ngoai',
    published: '2026-09-23',
    updated: '2026-09-27',
    lang: 'vi',
    // ⚠️ NO `categories`, deliberately: it is about foreigners' own used goods, and the used stock in
    // furniture-appliances is dealer-supplied — linking it there would present that stock as expats'
    // moving sales.
    label: 'Đồ cũ của người nước ngoài bán lại',
    blurb:
      'Vì sao đồ của người sắp về nước thường còn tốt mà rẻ, tìm ở đâu, và xem điểm uy tín người bán thế nào.',
  },
  {
    slug: 'renting-an-apartment-vietnam-foreigner',
    published: '2026-09-23',
    updated: '2026-09-27',
    lang: 'en',
    categories: ['rentals'],
    label: 'Renting an apartment in Vietnam as a foreigner',
    blurb:
      'How viewings and leases actually work here, what the deposit covers, and the clauses worth negotiating.',
  },
  {
    slug: 'rental-deposit-vietnam',
    published: '2026-09-23',
    updated: '2026-09-27',
    lang: 'en',
    categories: ['rentals'],
    label: 'Getting your rental deposit back in Vietnam',
    blurb:
      'What fair wear and tear means in practice, the handover photos that settle arguments, and how to escalate.',
  },
  {
    slug: 'ban-do-cu-o-dau-duoc-gia',
    published: '2026-09-23',
    updated: '2026-09-27',
    lang: 'vi',
    categories: ['furniture-appliances'],
    label: 'Bán đồ cũ ở đâu được giá',
    blurb:
      'Khoảng giá thị trường theo từng loại món, và khi nào bán xô cho cửa hàng thu mua mới thực sự hợp lý.',
  },
  /* ── HCMC vehicle hire, 2026-09-29 ──────────────────────────────────────────────────────────
   * Hubs rather than articles (src/components/marketplace/vehicle-hub.tsx): a live grid, counts and
   * a price summary with its method printed, over the car and motorbike hire imported with the
   * sources' permission on 2026-09-29 (~6,100 cars, ~230 bikes). Registered here so the sitemap,
   * the reserved handles and the hreflang pair see them. `published` is the hubs' launch day (6b3a2c75);
   * there is no `updated`: a hub's dateModified is its newest listing change (vehicleHubContent), not an edit.
   * ⚠️ NO `categories`: /c/rentals is homes-only and its Guides block is about homes; that page links
   * the hubs from its "Plus N cars and N motorbikes for hire" line instead (category-text.tsx).
   */
  {
    slug: 'car-rental-ho-chi-minh-city',
    lang: 'en',
    pair: 'thue-xe-tu-lai-tphcm',
    label: 'Car rental in Ho Chi Minh City',
    blurb: 'Self-drive cars on one page, what a day costs by car size, and how booking with the source works.',
    published: '2026-09-29',
  },
  {
    slug: 'thue-xe-tu-lai-tphcm',
    lang: 'vi',
    pair: 'car-rental-ho-chi-minh-city',
    label: 'Thuê xe tự lái TP.HCM',
    blurb: 'Xe tự lái gom về một trang, giá thuê một ngày theo loại xe, và cách đặt xe với nguồn.',
    published: '2026-09-29',
  },
  {
    slug: 'motorbike-rental-ho-chi-minh-city',
    lang: 'en',
    pair: 'thue-xe-may-tphcm',
    label: 'Motorbike rental in Ho Chi Minh City',
    blurb: 'Scooters and manual bikes from local shops, day and month prices kept apart, and how booking with the shop works.',
    published: '2026-09-29',
  },
  {
    slug: 'thue-xe-may-tphcm',
    lang: 'vi',
    pair: 'motorbike-rental-ho-chi-minh-city',
    label: 'Thuê xe máy TP.HCM',
    blurb: 'Xe ga và xe số từ các cửa hàng cho thuê, giá theo ngày và theo tháng tính riêng, và cách đặt xe với cửa hàng.',
    published: '2026-09-29',
  },
  {
    slug: 'dang-tin-ban-hang-mien-phi',
    published: '2026-09-23',
    updated: '2026-09-27',
    lang: 'vi',
    label: 'Đăng tin bán hàng miễn phí',
    blurb:
      'Đăng tin không mất phí, cần gì để tin được duyệt, và vì sao các quy định đó khiến miễn phí không thành rác.',
  },
] as const

/**
 * Reciprocal hreflang for a bilingual marketplace guide.
 *
 * Mirrors `phoneGuideAlternates()` in src/lib/phone-guides.ts deliberately — same shape, same
 * `x-default`, so the two clusters cannot diverge in how they declare themselves.
 *
 * ⛔ `x-default` POINTS AT THE ENGLISH ARTICLE. It is what Google serves a searcher whose language
 * matches neither tag, and omitting it lets Google choose — which on a .vn domain means the
 * Vietnamese page for everyone, including the English audience this marketplace is built for.
 *
 * ⚠️ A guide with no `pair` gets a bare canonical and NO `languages` key. Emitting a languages map
 * that points a language at a page which does not exist is worse than emitting none.
 */
export function marketplaceGuideAlternates(slug: string) {
  const self = MARKETPLACE_GUIDES.find((g) => g.slug === slug)
  const pair = self?.pair ? MARKETPLACE_GUIDES.find((g) => g.slug === self.pair) : undefined
  /**
   * ⚠️ BOTH SIDES MUST DECLARE A `lang`, NOT JUST THIS ONE. Checking only `self.lang` lets a
   * half-filled pair emit a ONE-WAY hreflang: the side with a lang prints a full languages map
   * naming both pages, while its partner falls through to a bare canonical. Google discards a
   * one-way pair outright, so the net effect is doing the work and getting none of the benefit —
   * and nothing looks wrong on either page on its own. Caught in review.
   */
  if (!self || !pair || !self.lang || !pair.lang || self.lang === pair.lang) {
    return { canonical: expatGuidePath(slug) }
  }
  const en = self.lang === 'en' ? self.slug : pair.slug
  const vi = self.lang === 'vi' ? self.slug : pair.slug
  return {
    canonical: expatGuidePath(slug),
    languages: {
      en: expatGuidePath(en),
      'vi-VN': expatGuidePath(vi),
      'x-default': expatGuidePath(en),
    },
  }
}

/** Route path for a guide, e.g. `/moving-to-vietnam`. */
export const expatGuidePath = (slug: string) => `/${slug}`

/** Every services-edition guide path, for the sitemap. */
export const EXPAT_GUIDE_PATHS: readonly string[] = EXPAT_GUIDES.map((g) => expatGuidePath(g.slug))

/**
 * The same guides as BARE SLUGS, for the reserved-handle set.
 *
 * ⛔ A ROOT-LEVEL ROUTE THAT IS NOT A RESERVED HANDLE IS A COLLISION WAITING TO HAPPEN: a seller
 * could claim `@ban-do-cu-o-dau-duoc-gia` and own a URL the router already gives to an article.
 * src/lib/handle-format.test.ts asserts every root page route is reserved, and it is what caught
 * this when seven guides were added — the two originals had been hard-coded into RESERVED by hand,
 * which is exactly the "thirty-two chances to forget one" that phone-guides.ts warns about.
 *
 * ⚠️ BARE SLUGS, NOT PATHS. `MARKETPLACE_GUIDE_PATHS` carries a leading `/` for the sitemap; a
 * handle never does, so spreading that list into RESERVED would silently match nothing.
 */
export const MARKETPLACE_GUIDE_SLUGS: readonly string[] = MARKETPLACE_GUIDES.map((g) => g.slug)

/** Services-edition guide slugs, reserved for the same reason — the routes exist on eno.forum. */
export const EXPAT_GUIDE_SLUGS: readonly string[] = EXPAT_GUIDES.map((g) => g.slug)

/** Every marketplace guide path, for the sitemap. These routes exist on both editions. */
export const MARKETPLACE_GUIDE_PATHS: readonly string[] = MARKETPLACE_GUIDES.map((g) => expatGuidePath(g.slug))

/**
 * Crawlable links to the other guides. Pass the current guide's slug so a page does not link to
 * itself; pass nothing (from outside the set) to get all of them.
 */
export function expatGuidesExcept(slug?: string) {
  return EXPAT_GUIDES.filter((g) => g.slug !== slug).map((g) => ({
    href: expatGuidePath(g.slug),
    label: g.label,
    blurb: g.blurb,
  }))
}

/**
 * The marketplace guides' "Keep reading" block — same shape, its own list.
 *
 * ⛔ IT NEVER CROSSES LANGUAGES. A Vietnamese article linking "Keep reading" to English siblings
 * sends a Vietnamese reader to a page they cannot read, and tells Google the two are related
 * content rather than translations — which is what the hreflang pair is for. A guide with no
 * `lang` (the two original English-only ones) is treated as English.
 *
 * ⚠️ THE FIRST GUIDE IN A NEW LANGUAGE GETS AN EMPTY LIST, AND THAT IS HANDLED, NOT IGNORED.
 * `SeoArticle` renders the block only on `related.length > 0` (seo-article.tsx:299), so the
 * section disappears rather than printing a heading with nothing under it. The cost is real but
 * small — that one article is not linked from its siblings until a second one in its language
 * exists — and it is strictly better than shipping a Vietnamese reader a row of English cards.
 */
export function marketplaceGuidesExcept(slug?: string) {
  const self = MARKETPLACE_GUIDES.find((g) => g.slug === slug)
  const lang = self?.lang ?? 'en'
  return MARKETPLACE_GUIDES.filter((g) => g.slug !== slug && (g.lang ?? 'en') === lang).map((g) => ({
    href: expatGuidePath(g.slug),
    label: g.label,
    blurb: g.blurb,
  }))
}

/**
 * A guide's `published` and (when it has one) `updated` date, from its registry entry — for the
 * page to spread into its `ArticleContent`. Single-sourced across all three guide lists.
 *
 * ⚠️ THROWS ON AN UNKNOWN SLUG. Every caller passes a literal, so a typo fails the build of that
 * page instead of shipping an Article with no `datePublished`.
 */
export function guideDates(slug: string): { published: string; updated?: string } {
  const guide = [...EXPAT_GUIDES, ...MARKETPLACE_GUIDES, ...PHONE_GUIDES].find((g) => g.slug === slug)
  if (!guide) throw new Error(`guideDates: "${slug}" is in no guide registry`)
  return guide.updated ? { published: guide.published, updated: guide.updated } : { published: guide.published }
}
