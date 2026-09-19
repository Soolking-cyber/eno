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
  // 9 ── claiming the vat refund on a phone ─────────────────────────────────────────────
  {
    slug: 'vat-refund-phone-vietnam',
    lang: 'en',
    pair: 'hoan-thue-vat-mua-dien-thoai',
    label: 'Claiming the VAT refund on a phone',
    blurb: 'How the 10% airport refund works, which invoice you need, and the threshold that decides whether it is worth the queue.',
  },
  {
    slug: 'hoan-thue-vat-mua-dien-thoai',
    lang: 'vi',
    pair: 'vat-refund-phone-vietnam',
    label: 'Hoàn thuế VAT khi mua điện thoại',
    blurb: 'Thủ tục hoàn thuế VAT tại sân bay, cần hóa đơn loại nào, và mức tiền từ bao nhiêu thì đáng làm.',
  },
  // 10 ── which ipad to buy in vietnam ─────────────────────────────────────────────
  {
    slug: 'ipad-buying-guide-vietnam',
    lang: 'en',
    pair: 'mua-ipad-loai-nao-tot',
    label: 'Which iPad to buy in Vietnam',
    blurb: 'Air, Pro, mini or the base model — what each is actually for, and which storage tier is a trap.',
  },
  {
    slug: 'mua-ipad-loai-nao-tot',
    lang: 'vi',
    pair: 'ipad-buying-guide-vietnam',
    label: 'Mua iPad loại nào tốt',
    blurb: 'Air, Pro, mini hay bản thường — mỗi dòng hợp với ai, và mức dung lượng nào không nên mua.',
  },
  // 11 ── cheap 5g phones in vietnam ─────────────────────────────────────────────
  {
    slug: 'budget-5g-phones-vietnam',
    lang: 'en',
    pair: 'dien-thoai-5g-gia-re',
    label: 'Cheap 5G phones in Vietnam',
    blurb: 'What 5G actually costs to get into here, where coverage is real, and the specs worth paying for at the bottom of the range.',
  },
  {
    slug: 'dien-thoai-5g-gia-re',
    lang: 'vi',
    pair: 'budget-5g-phones-vietnam',
    label: 'Điện thoại 5G giá rẻ',
    blurb: 'Giá rẻ nhất để lên 5G, vùng phủ sóng thực tế, và thông số nào đáng tiền ở phân khúc phổ thông.',
  },
  // 12 ── phone warranty and repair in vietnam ─────────────────────────────────────────────
  {
    slug: 'phone-warranty-repair-vietnam',
    lang: 'en',
    pair: 'bao-hanh-sua-chua-dien-thoai',
    label: 'Phone warranty and repair in Vietnam',
    blurb: 'Who honours what, what an independent repair costs, and the repairs that void everything else.',
  },
  {
    slug: 'bao-hanh-sua-chua-dien-thoai',
    lang: 'vi',
    pair: 'phone-warranty-repair-vietnam',
    label: 'Bảo hành và sửa chữa điện thoại',
    blurb: 'Ai bảo hành cái gì, sửa ngoài hết bao nhiêu, và những sửa chữa làm mất bảo hành.',
  },
  // 13 ── selling your phone in vietnam ─────────────────────────────────────────────
  {
    slug: 'selling-your-phone-vietnam',
    lang: 'en',
    pair: 'ban-dien-thoai-cu-duoc-gia',
    label: 'Selling your phone in Vietnam',
    blurb: 'Trade-in against private sale, what raises the price, and the timing that costs the most.',
  },
  {
    slug: 'ban-dien-thoai-cu-duoc-gia',
    lang: 'vi',
    pair: 'selling-your-phone-vietnam',
    label: 'Bán điện thoại cũ được giá',
    blurb: 'Thu cũ đổi mới hay bán trực tiếp, điều gì làm tăng giá, và thời điểm bán quyết định bao nhiêu.',
  },
  // 14 ── the best-value phones in vietnam ─────────────────────────────────────────────
  {
    slug: 'best-value-phones-vietnam',
    lang: 'en',
    pair: 'dien-thoai-tam-trung-dang-mua',
    label: 'The best-value phones in Vietnam',
    blurb: 'Where the mid-range genuinely beats a flagship, and the three specs that age worst.',
  },
  {
    slug: 'dien-thoai-tam-trung-dang-mua',
    lang: 'vi',
    pair: 'best-value-phones-vietnam',
    label: 'Điện thoại tầm trung đáng mua',
    blurb: 'Khi nào máy tầm trung hơn hẳn flagship, và ba thông số xuống cấp nhanh nhất.',
  },
  // 15 ── which samsung galaxy to buy in vietnam ─────────────────────────────────────────────
  {
    slug: 'samsung-galaxy-buying-guide-vietnam',
    lang: 'en',
    pair: 'mua-samsung-galaxy-dong-nao',
    label: 'Which Samsung Galaxy to buy in Vietnam',
    blurb: 'S, A, M and Z explained, and why Samsung pricing moves further here than Apple\u2019s.',
  },
  {
    slug: 'mua-samsung-galaxy-dong-nao',
    lang: 'vi',
    pair: 'samsung-galaxy-buying-guide-vietnam',
    label: 'Mua Samsung Galaxy dòng nào',
    blurb: 'Phân biệt dòng S, A, M và Z, và vì sao giá Samsung giảm sâu hơn Apple tại Việt Nam.',
  },
  // 16 ── iphone battery replacement in vietnam ─────────────────────────────────────────────
  {
    slug: 'iphone-battery-replacement-vietnam',
    lang: 'en',
    pair: 'thay-pin-iphone-o-dau',
    label: 'iPhone battery replacement in Vietnam',
    blurb: 'When to replace, official against independent, and how a third-party cell shows up in Settings.',
  },
  {
    slug: 'thay-pin-iphone-o-dau',
    lang: 'vi',
    pair: 'iphone-battery-replacement-vietnam',
    label: 'Thay pin iPhone ở đâu',
    blurb: 'Khi nào nên thay, thay chính hãng hay ngoài, và dấu hiệu nhận ra pin lô trong Cài đặt.',
  },
  // 17 ── the best phones under 10 million đồng ─────────────────────────────────────────────
  {
    slug: 'phones-under-10-million-vietnam',
    lang: 'en',
    pair: 'dien-thoai-duoi-10-trieu',
    label: 'The best phones under 10 million đồng',
    blurb: 'What that budget buys new, what it buys second-hand, and which of the two is the better phone.',
  },
  {
    slug: 'dien-thoai-duoi-10-trieu',
    lang: 'vi',
    pair: 'phones-under-10-million-vietnam',
    label: 'Điện thoại dưới 10 triệu',
    blurb: 'Ngân sách đó mua được máy mới nào, máy cũ nào, và bên nào đáng hơn.',
  },
  // 18 ── phone accessories worth buying in vietnam ─────────────────────────────────────────────
  {
    slug: 'phone-accessories-vietnam',
    lang: 'en',
    pair: 'phu-kien-dien-thoai-nen-mua',
    label: 'Phone accessories worth buying in Vietnam',
    blurb: 'Cases, glass, chargers and cables — what the climate here actually demands and what is a markup.',
  },
  {
    slug: 'phu-kien-dien-thoai-nen-mua',
    lang: 'vi',
    pair: 'phone-accessories-vietnam',
    label: 'Phụ kiện điện thoại nên mua',
    blurb: 'Ốp, cường lực, sạc và cáp — khí hậu ở đây đòi hỏi gì, và thứ gì chỉ là tiền oan.',
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
