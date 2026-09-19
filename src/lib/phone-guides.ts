/**
 * THE PHONE BUYING GUIDES — one registry for a bilingual cluster, so no route can ship unlisted.
 *
 * Same idiom and the same reason as `expat-guides.ts`: the sitemap's static page list is hand-written,
 * which is exactly how a page gets built, deployed and never submitted to Google. `handle-format.ts`
 * reads the slugs too — a member holding `@mua-iphone-o-dau-uy-tin` would shadow the route silently,
 * because `/[handle]` renders a storefront IN PLACE rather than 404ing. Sixteen routes across two
 * registries is thirty-two chances to forget one; this is one list instead.
 *
 * ⛔ EACH TOPIC IS TWO ARTICLES, NOT ONE ARTICLE TRANSLATED. Vietnamese phone shoppers do not search
 * translated English — they type "mua iphone ở đâu uy tín", "chính hãng hay xách tay", "trả góp 0%",
 * "có nên lên đời". An English page serving Vietnamese text ranks for neither, and a machine
 * translation of English copy answers questions Vietnamese buyers are not asking. So the pair share a
 * subject and nothing else: native slug, native prose, native questions. They point at each other
 * with reciprocal `hreflang`, which is what stops Google treating one as a duplicate of the other.
 *
 * ⚠️ SLUGS ARE UNACCENTED ASCII. `handle-format.ts` validates `^[a-z][a-z0-9_]{2,29}$` and a route
 * segment with `ế` in it is a percent-encoded mess in every share link. Vietnamese readers search
 * unaccented constantly; the accents belong in the title, not the URL.
 *
 * ⚠️ NO VISA, ITINERARY OR PAYPAL VOCABULARY IN ANY VALUE — same rule as the expat registry, and for
 * the same reason: `src/app/sitemap.xml/route.ts` compiles on BOTH editions, so every string here
 * lands in the licensed marketplace's bundle. Phones are safe subject matter; keep it that way.
 */
export type PhoneGuide = {
  /** Top-level route segment, unaccented ASCII. */
  slug: string
  /** The language the article is WRITTEN in — drives `inLanguage` and the hreflang pair. */
  lang: 'en' | 'vi'
  /** The same subject in the other language. Reciprocal: if A names B, B must name A. */
  pair: string
  /** Link text used by sibling guides, in the guide's own language. */
  label: string
  /** One line of what it answers — the link's whole reason to be clicked. */
  blurb: string
}

export const PHONE_GUIDES: readonly PhoneGuide[] = [
  // 1 ── where to buy ─────────────────────────────────────────────────────────
  {
    slug: 'best-place-to-buy-iphone-vietnam',
    lang: 'en',
    pair: 'mua-iphone-o-dau-uy-tin',
    label: 'Where to buy an iPhone in Vietnam',
    blurb: 'The five kinds of shop that sell iPhones here, what each is good for, and the one question to ask before paying.',
  },
  {
    slug: 'mua-iphone-o-dau-uy-tin',
    lang: 'vi',
    pair: 'best-place-to-buy-iphone-vietnam',
    label: 'Mua iPhone ở đâu uy tín',
    blurb: 'Năm kiểu cửa hàng bán iPhone, nơi nào hợp với ai, và câu hỏi cần hỏi trước khi trả tiền.',
  },
  // 2 ── genuine vs grey import ───────────────────────────────────────────────
  {
    slug: 'chinh-hang-vs-xach-tay-vietnam',
    lang: 'en',
    pair: 'iphone-chinh-hang-va-xach-tay',
    label: 'Chính hãng VN/A vs xách tay, explained',
    blurb: 'What the model-number suffix means, who honours the warranty, and when the cheaper grey unit is still the right buy.',
  },
  {
    slug: 'iphone-chinh-hang-va-xach-tay',
    lang: 'vi',
    pair: 'chinh-hang-vs-xach-tay-vietnam',
    label: 'iPhone chính hãng và xách tay khác nhau thế nào',
    blurb: 'Đuôi mã máy VN/A, LL/A, ZA/A nghĩa là gì, ai bảo hành, và khi nào nên chọn hàng xách tay.',
  },
  // 3 ── buying used ──────────────────────────────────────────────────────────
  {
    slug: 'buying-a-used-iphone-vietnam',
    lang: 'en',
    pair: 'kinh-nghiem-mua-iphone-cu',
    label: 'Buying a used iPhone in Vietnam',
    blurb: 'The ten-minute inspection that catches a swapped screen, a tired battery and a locked iCloud before any money moves.',
  },
  {
    slug: 'kinh-nghiem-mua-iphone-cu',
    lang: 'vi',
    pair: 'buying-a-used-iphone-vietnam',
    label: 'Kinh nghiệm mua iPhone cũ',
    blurb: 'Mười phút kiểm tra để phát hiện màn hình thay, pin chai và iCloud ẩn trước khi xuống tiền.',
  },
  // 4 ── instalments ──────────────────────────────────────────────────────────
  {
    slug: 'phone-instalments-vietnam',
    lang: 'en',
    pair: 'mua-dien-thoai-tra-gop',
    label: 'Phone instalments in Vietnam, and the 0% that is not 0%',
    blurb: 'How trả góp actually works, what the paperwork requires, and the fees that turn a 0% plan into an 8% one.',
  },
  {
    slug: 'mua-dien-thoai-tra-gop',
    lang: 'vi',
    pair: 'phone-instalments-vietnam',
    label: 'Mua điện thoại trả góp 0% có thật sự 0%',
    blurb: 'Trả góp qua thẻ và qua công ty tài chính khác nhau ra sao, cần giấy tờ gì, và các khoản phí ẩn.',
  },
  // 5 ── upgrade or not ───────────────────────────────────────────────────────
  {
    slug: 'iphone-18-vs-iphone-17-vietnam',
    lang: 'en',
    pair: 'co-nen-len-doi-iphone-18',
    label: 'iPhone 18 vs iPhone 17: worth the upgrade?',
    blurb: 'What actually changed, what it costs to switch here, and which older model is the better buy today.',
  },
  {
    slug: 'co-nen-len-doi-iphone-18',
    lang: 'vi',
    pair: 'iphone-18-vs-iphone-17-vietnam',
    label: 'Có nên lên đời iPhone 18',
    blurb: 'Khác biệt thật sự so với iPhone 17, chi phí đổi máy, và đời máy nào đang đáng mua nhất.',
  },
  // 6 ── iPhone or Samsung ────────────────────────────────────────────────────
  {
    slug: 'iphone-vs-samsung-vietnam',
    lang: 'en',
    pair: 'nen-mua-iphone-hay-samsung',
    label: 'iPhone or Samsung in Vietnam',
    blurb: 'Resale value, repair networks and real prices here — the three things that decide it locally.',
  },
  {
    slug: 'nen-mua-iphone-hay-samsung',
    lang: 'vi',
    pair: 'iphone-vs-samsung-vietnam',
    label: 'Nên mua iPhone hay Samsung',
    blurb: 'Giá bán lại, hệ thống bảo hành và giá thực tế tại Việt Nam — ba yếu tố quyết định.',
  },
  // 7 ── foldables ────────────────────────────────────────────────────────────
  {
    slug: 'foldable-phones-vietnam',
    lang: 'en',
    pair: 'dien-thoai-gap-nen-mua-loai-nao',
    label: 'Foldable phones in Vietnam',
    blurb: 'Apple’s first fold against Samsung’s seventh: what breaks, what it costs to fix, and who should wait.',
  },
  {
    slug: 'dien-thoai-gap-nen-mua-loai-nao',
    lang: 'vi',
    pair: 'foldable-phones-vietnam',
    label: 'Điện thoại gập nên mua loại nào',
    blurb: 'Máy gập đời đầu của Apple so với Samsung: hỏng ở đâu, sửa hết bao nhiêu, ai nên chờ.',
  },
  // 8 ── eSIM ─────────────────────────────────────────────────────────────────
  {
    slug: 'esim-vietnam-guide',
    lang: 'en',
    pair: 'esim-viettel-vinaphone-mobifone',
    label: 'eSIM in Vietnam: networks, phones and setup',
    blurb: 'Which networks issue eSIM, which handsets take it, and what a foreigner needs to register one.',
  },
  {
    slug: 'esim-viettel-vinaphone-mobifone',
    lang: 'vi',
    pair: 'esim-vietnam-guide',
    label: 'eSIM Viettel, VinaPhone, MobiFone: lắp thế nào',
    blurb: 'Nhà mạng nào hỗ trợ eSIM, máy nào dùng được, và thủ tục đăng ký cần gì.',
  },
] as const

/** Every phone-guide path, for the sitemap. */
export const PHONE_GUIDE_PATHS: readonly string[] = PHONE_GUIDES.map((g) => g.slug)

/** The guides in one language — each article links its same-language siblings, never across. */
export function phoneGuidesIn(lang: 'en' | 'vi', exceptSlug?: string): PhoneGuide[] {
  return PHONE_GUIDES.filter((g) => g.lang === lang && g.slug !== exceptSlug)
}

/** The translation counterpart of a guide, for the reciprocal hreflang pair. */
export function phoneGuidePair(slug: string): PhoneGuide | undefined {
  const self = PHONE_GUIDES.find((g) => g.slug === slug)
  return self && PHONE_GUIDES.find((g) => g.slug === self.pair)
}

/**
 * Canonical + reciprocal hreflang for one guide, so a page file cannot get the pair wrong.
 *
 * ⛔ `x-default` POINTS AT THE ENGLISH ARTICLE, deliberately. It is what Google serves a searcher
 * whose language matches neither tag, and leaving it out lets Google pick — which on a .vn domain
 * means the Vietnamese page for everyone. ⚠️ The alternates must be RECIPROCAL: a one-way pair is
 * ignored outright, which is why both sides read from this one function.
 */
export function phoneGuideAlternates(slug: string) {
  const self = PHONE_GUIDES.find((g) => g.slug === slug)
  const pair = phoneGuidePair(slug)
  if (!self || !pair) return { canonical: `/${slug}` }
  const en = self.lang === 'en' ? self.slug : pair.slug
  const vi = self.lang === 'vi' ? self.slug : pair.slug
  return {
    canonical: `/${slug}`,
    languages: { en: `/${en}`, 'vi-VN': `/${vi}`, 'x-default': `/${en}` },
  }
}
