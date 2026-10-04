'use client'

// ── Search & ranking transparency, the rendered copy ─────────────────────────────────────────────
//
// Required disclosure of the main ranking parameters and their relative importance
// (Luật Thương mại điện tử 122/2025/QH15; Nghị định 248/2026/NĐ-CP Điều 11). Architecture:
// docs/compliance-2026.md §4.1. The Quy chế's Article 14 (/regulations#ranking) says the same things in
// the filed document — change one and change the other.
//
// ⚠️ THIS IS A CLIENT COMPONENT ON PURPOSE, so every sentence can use `tr(en, vi)` with CURATED
// Vietnamese. The machine-translation path is fine for product copy and wrong here: this text is a
// legal statement about our own ranker, served to Vietnamese regulators and users, and a machine
// rendering of "buyer interest saturates" is not something we want to discover after the fact.
//
// ⚠️ NOT ONE NUMBER ON THIS PAGE IS TYPED BY HAND. The weights come from
// `@/lib/compliance/ranking-disclosure`, which derives them from the live `RANK` constants
// (`ranking-disclosure.test.ts` fails the build if the two diverge), and the diversity window arrives
// as a prop from page.tsx, which reads FEED_DIVERSITY_WINDOW on the server — importing
// feed-diversity here would drag the publish guard into the client bundle.
//
// ⛔ THREE SENTENCES THIS PAGE USED TO PUBLISH WERE FALSE (corrected 2026-10-01):
//   · "no result is reordered based on who you are" / "we do not use your browsing history" — TWO rails
//     use on-device history: For You (recent searches + viewed categories/brands; for-you-rail.tsx,
//     src/lib/reco-signals.ts — home view, and the `recovery` rail under a sparse search) and Recently
//     viewed (listings opened on this device; recently-viewed-rail.tsx — home view and every PDP), both
//     gated on personalizationAllowed(). Both are now disclosed, with how to switch them off.
//   · "[the boost] cannot be increased by paying more" implied featured placement is bought at all. It
//     is not: `featured` is set only by the admin listings route, never by any payment path.
//   · "featured listings … are always visibly labelled" — no featured label renders anywhere. The page
//     states the rule only: NOT "none is featured today" (a database fact one admin click falsifies)
//     and NOT a promised label (nothing renders one).
// ⚠️ THE PERSONALISATION COPY NAMES THE SWITCH, NOT ITS DEFAULT — true before Consent v2 (on unless
// declined) and after it (off until chosen); /privacy states the default.
// ⛔ THE "Ads and commission" SECTION SHIPS ONLY WITH W-C (the Ad marker and commission note).

import { useLanguage } from '@/context/language-context'
import { ContentPage, ContentSection } from '@/components/marketplace/content-page'
import { SITE_NAME } from '@/lib/edition'
import { LEGAL_BASIS } from '@/lib/compliance/legal-basis'
import { dateEn, dateVi } from '@/lib/compliance/legal-amendment'
import {
  browseFactors,
  searchFactors,
  FEATURED_BOOST_PCT,
  RANKING_DISCLOSURE_UPDATED,
  type RankingFactor,
} from '@/lib/compliance/ranking-disclosure'

function FactorList({ factors }: { factors: RankingFactor[] }) {
  const { lang } = useLanguage()
  return (
    <ul className="space-y-3">
      {factors.map((f) => (
        <li key={f.key} className="flex gap-3">
          {/* tabular-nums keeps the percentage column aligned down the list. */}
          <span className="w-12 shrink-0 text-right font-bold tabular-nums text-foreground">
            {f.weightPct}%
          </span>
          <span className="min-w-0">
            <strong className="text-foreground">{lang === 'vi' ? f.labelVi : f.labelEn}</strong>
            {' — '}
            {lang === 'vi' ? f.explainVi : f.explainEn}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function RankingContent({ diversityWindow }: { diversityWindow: number }) {
  const { tr } = useLanguage()
  return (
    <ContentPage
      title="How we rank results"
      titleVi="Cách chúng tôi sắp xếp kết quả"
      // ⚠️ THE PAGE'S OWN DATE (ranking-disclosure.ts RANKING_DISCLOSURE_UPDATED, set on deploy day), not the
      // legal amendment's: this disclosure follows the code and changes between amendments.
      meta={tr(
        `Published under ${LEGAL_BASIS.ecommerceLaw.en} · Last updated: ${dateEn(RANKING_DISCLOSURE_UPDATED)}`,
        `Công bố theo ${LEGAL_BASIS.ecommerceLaw.vi} · Cập nhật lần cuối: ${dateVi(RANKING_DISCLOSURE_UPDATED)}`,
      )}
      intro={tr(
        `${SITE_NAME} does not sell placement: no listing appears higher because someone paid for it. Category browsing and search results are the same for everyone; the two rails that can adapt to you, For You and Recently viewed, are explained below — and they adapt only while personalisation is on in your cookie settings.`,
        `${SITE_NAME} không bán vị trí hiển thị: không tin đăng nào được xếp cao hơn nhờ trả tiền. Kết quả duyệt danh mục và kết quả tìm kiếm giống nhau với mọi người; hai mục có thể thay đổi theo bạn là “Dành cho bạn” và “Đã xem gần đây”, được giải thích bên dưới — và chúng chỉ thay đổi khi cá nhân hoá trong phần cài đặt cookie đang bật.`,
      )}
      sections={[
        { id: 'browse', label: 'Browsing', labelVi: 'Khi duyệt' },
        { id: 'search', label: 'Searching', labelVi: 'Khi tìm kiếm' },
        { id: 'diversity', label: 'Seller diversity', labelVi: 'Đa dạng người bán' },
        { id: 'guides', label: 'Guide pages', labelVi: 'Trang hướng dẫn' },
        { id: 'for-you', label: 'Personalised rails', labelVi: 'Các mục cá nhân hoá' },
        { id: 'featured', label: 'Featured listings', labelVi: 'Tin nổi bật' },
        { id: 'commission', label: 'Ads and commission', labelVi: 'Quảng cáo và hoa hồng' },
        { id: 'not-used', label: 'What we do not use', labelVi: 'Điều chúng tôi không dùng' },
        { id: 'your-score', label: 'Your own score', labelVi: 'Điểm của bạn' },
      ]}
    >
      <ContentSection id="browse" title="When you browse a category" titleVi="Khi bạn duyệt một danh mục">
        <p>
          {tr(
            'With no search query, the order is a single weighted score. Seller trust leads, buyer interest follows, and freshness breaks ties:',
            'Khi không có từ khoá tìm kiếm, thứ tự được tính bằng một điểm tổng hợp có trọng số. Điểm uy tín của người bán dẫn đầu, tiếp đến là mức độ quan tâm của người mua, và độ mới dùng để phân định:',
          )}
        </p>
        <FactorList factors={browseFactors()} />
      </ContentSection>

      <ContentSection id="search" title="When you search" titleVi="Khi bạn tìm kiếm">
        <p>
          {tr(
            'Once you type a query, matching what you asked for takes the lead — a trusted seller with the wrong item does not help you — but trust remains a heavyweight co-factor:',
            'Khi bạn nhập từ khoá, mức độ phù hợp với yêu cầu của bạn được ưu tiên — một người bán uy tín nhưng không đúng món hàng thì không giúp được gì — nhưng điểm uy tín của người bán vẫn là yếu tố quan trọng:',
          )}
        </p>
        <FactorList factors={searchFactors()} />
        {/* keyword-rank.ts, header steps 1–4 (the title/model/brand tier before the category tier — text-relevance.ts
            MatchClass); feed-query.ts `priorityCategory` for the brand rule — a stable sort of each returned PAGE
            (api/listings/route.ts, `ordered`), never across pages.
            ⚖️ UX PROGRAM 2 (2026-10-04) CHANGED THIS PAGE AND NOT THE QUY CHẾ. The title tier, the condition words
            (next paragraph) and the vehicle storefronts' shared seat (#diversity) are NOT in Article 14
            (/regulations#ranking): editing the filed, versioned Quy chế is an amendment (Article 15: 5 days'
            notice, a new version, an Article 17 entry, MoIT re-filing once registered), which is the owner's
            and counsel's call. Until they make it, Article 14 still says what it said on 01/10/2026. */}
        <p>
          {tr(
            'With the default order, listings come first when every word you typed is in their own title, model or brand, or is the name of the aisle they are listed in; then come listings that need their category for one of the words, each group ranked by the score above. Listings that match only elsewhere, such as in the description, follow in the browse order. Listings with exactly equal scores are interleaved by seller and by model. If you search for a brand while browsing a category, each page of results puts that brand’s listings in your category ahead of the rest of that page; no listing moves from one page to another.',
            'Với thứ tự mặc định, các tin được xếp trước khi mọi từ bạn nhập đều có trong tiêu đề, mẫu mã hoặc thương hiệu của chính tin đó, hoặc là tên của mục mà tin được đăng; tiếp theo là các tin cần đến danh mục của tin để khớp một trong các từ, mỗi nhóm theo điểm nêu trên. Các tin chỉ khớp ở phần khác, như phần mô tả, được xếp sau theo thứ tự khi duyệt. Các tin bằng điểm nhau được xếp xen kẽ theo người bán và mẫu sản phẩm. Nếu bạn tìm một thương hiệu khi đang xem một danh mục, trong mỗi trang kết quả, tin của thương hiệu đó thuộc danh mục bạn đang xem được đưa lên trước các tin còn lại của trang; không tin nào bị chuyển từ trang kết quả này sang trang khác.',
          )}
        </p>
        {/* search-synonyms.ts splitConditionWords → feed-query.ts: the words leave the text and filter NOTHING
            (commit gate, 2026-10-04 — the wizard stores "Như mới" / like-new as 'new'); a query of condition
            words only gets the sale scope (`listingType: 'sell'`, `saleScopeFromWords`); an explicit
            `?condition=` applies as usual and an explicit `?type=` replaces the sale scope.
            ⚠️ The English stays ≤ 400 characters (below). */}
        <p>
          {tr(
            'Words that describe condition, such as “second hand”, “used”, “cũ” or “đồ cũ”, are not looked for in the listing text and do not filter by condition. A search made only of such words shows the items for sale. A condition or listing type you pick in the filters applies as usual.',
            'Các từ chỉ tình trạng, như “second hand”, “used”, “cũ” hoặc “đồ cũ”, không được dùng để tìm trong nội dung tin và không lọc theo tình trạng. Nếu từ khoá chỉ gồm những từ này, kết quả là các món hàng đang được đăng bán. Tình trạng hoặc loại tin bạn tự chọn trong bộ lọc vẫn được áp dụng như bình thường.',
          )}
        </p>
        <p>
          {tr(
            'You can always choose your own order instead — newest, price low to high, price high to low — and filter by category, area, price and other details. Your choice replaces the default order.',
            'Bạn luôn có thể tự chọn cách sắp xếp khác — mới nhất, giá từ thấp đến cao, giá từ cao đến thấp — và lọc theo danh mục, khu vực, giá cùng các thông tin khác. Lựa chọn của bạn thay cho thứ tự mặc định.',
          )}
        </p>
      </ContentSection>

      <ContentSection id="diversity" title="Seller diversity" titleVi="Đa dạng người bán">
        {/* src/lib/feed-diversity.ts: FEED_DIVERSITY_WINDOW, SHARED_SEAT_SUBCATEGORIES, SHARED_SEAT_SELLERS. */}
        <p>
          {tr(
            `On the home page and when you browse a category in the default order, the first ${diversityWindow} positions are dealt out by seller: every seller’s best listing first, then every seller’s second, and so on. Within each round the score order is kept, and nothing is hidden — a seller with many listings simply cannot fill the first screen.`,
            `Ở trang chủ và khi bạn duyệt một danh mục theo thứ tự mặc định, ${diversityWindow} vị trí đầu tiên được chia lần lượt theo người bán: tin tốt nhất của mỗi người bán trước, rồi đến tin thứ hai của mỗi người bán, và cứ thế tiếp tục. Trong mỗi lượt, thứ tự theo điểm được giữ nguyên và không tin nào bị ẩn — chỉ là một người bán có nhiều tin không thể chiếm hết màn hình đầu.`,
          )}
        </p>
        {/* ⚠️ THE ENGLISH STAYS ≤ 400 CHARACTERS: scripts/gen-ui-strings.mjs drops longer strings, and with them
            the warmed translations the nine machine-translated languages read (the 2026-10-01 sentence fit). */}
        <p>
          {tr(
            'eSIM plans from every carrier share one seat in that rotation, as do job postings linked from job boards and vehicle rentals linked from rental platforms and shops, so that a catalogue split across many storefronts cannot take over the first page either. Open the eSIM aisle, the Jobs category or a vehicle rental aisle itself and every carrier, job board and rental shop gets its own seat again.',
            'Các gói eSIM của mọi nhà mạng dùng chung một vị trí trong lượt chia đó, tin tuyển dụng dẫn từ các trang tuyển dụng và tin cho thuê xe dẫn từ các nền tảng, cửa hàng cho thuê xe cũng vậy, để một danh mục do nhiều gian hàng cung cấp cũng không chiếm hết trang đầu. Khi bạn mở riêng mục eSIM, danh mục Việc làm hoặc một mục cho thuê xe, mỗi nhà mạng, mỗi trang tuyển dụng, mỗi cửa hàng cho thuê xe lại có vị trí riêng.',
          )}
        </p>
      </ContentSection>

      <ContentSection id="guides" title="On guide and topic pages" titleVi="Trên trang hướng dẫn và trang chủ đề">
        {/* seo-listing-rail.tsx `orderBy` and its photo-first partition. */}
        <p>
          {tr(
            'The live listing panels on our guides show the cheapest first when they cover one product type or one model, because what it costs is the question those pages answer. A panel for a whole category shows featured listings first, then the newest; a panel spanning several kinds of home puts listings with three or more photos first.',
            'Danh sách tin đăng trên các trang hướng dẫn hiển thị tin rẻ nhất trước khi danh sách đó dành cho một loại sản phẩm hoặc một mẫu cụ thể, vì giá là điều những trang ấy trả lời. Danh sách dành cho cả một danh mục hiển thị tin nổi bật trước, rồi đến tin mới nhất; danh sách gồm nhiều loại nhà ở ưu tiên tin có từ ba ảnh trở lên.',
          )}
        </p>
      </ContentSection>

      <ContentSection id="for-you" title="For You and Recently viewed" titleVi="“Dành cho bạn” và “Đã xem gần đây”">
        {/* for-you-rail.tsx + src/lib/reco-signals.ts + /api/recommendations; recently-viewed-rail.tsx.
            Both read personalizationAllowed() (src/lib/consent.ts). The copy names the switch, not its
            default — see the header. */}
        <p>
          {tr(
            'The For You rail appears on the home page, and below a search or filter that finds only a few listings. It is personalised only while personalisation is on in the cookie settings. Then your recent searches, and the categories and brands you have viewed, are used to choose its listings. Those are kept on your own device and sent only with the request that loads the rail.',
            'Mục “Dành cho bạn” xuất hiện ở trang chủ, và bên dưới kết quả tìm kiếm hoặc lọc khi chỉ có ít kết quả. Mục này chỉ được cá nhân hoá khi tuỳ chọn cá nhân hoá trong phần cài đặt cookie đang bật. Khi đó, các từ khoá bạn tìm gần đây cùng các danh mục, thương hiệu bạn đã xem được dùng để chọn tin cho mục này. Những dữ liệu này được lưu trên chính thiết bị của bạn và chỉ được gửi kèm yêu cầu tải mục này.',
          )}
        </p>
        <p>
          {tr(
            'With personalisation off, the rail shows what is drawing the most interest right now — the same for everyone. If you arrive through a link or an ad that carries search words, those words may shape the rail for that visit only; they are not stored. Personalisation changes only which listings appear in this rail: their order still follows the scores above.',
            'Khi tắt cá nhân hoá, mục này hiển thị những tin đang được quan tâm nhiều — giống nhau với mọi người. Nếu bạn đến từ một đường dẫn hoặc quảng cáo có kèm từ khoá, từ khoá đó có thể được dùng cho riêng lượt truy cập ấy và không được lưu lại. Cá nhân hoá chỉ quyết định tin nào xuất hiện trong mục này; thứ tự của chúng vẫn theo các điểm nêu trên.',
          )}
        </p>
        <p>
          {tr(
            'Also only while personalisation is on, a Recently viewed rail on the home page and on listing pages shows the listings you opened on this device, the most recent first. That list is kept on your device too, and sent only with the request that loads the rail.',
            'Cũng chỉ khi cá nhân hoá đang bật, mục “Đã xem gần đây” ở trang chủ và trang tin đăng hiển thị các tin bạn đã mở trên thiết bị này, tin mở gần nhất xếp trước. Danh sách đó cũng được lưu trên thiết bị của bạn và chỉ được gửi kèm yêu cầu tải mục này.',
          )}
        </p>
        <p>
          {tr(
            'To switch personalisation on or off, use the Cookie settings link in the footer. You can also remove recent searches one by one in the search box, or clear this site’s data in your browser.',
            'Để bật hoặc tắt cá nhân hoá, hãy dùng liên kết “Cài đặt cookie” ở chân trang. Bạn cũng có thể xoá từng từ khoá gần đây trong ô tìm kiếm, hoặc xoá dữ liệu của trang web này trong trình duyệt.',
          )}
        </p>
      </ContentSection>

      <ContentSection id="featured" title="Featured listings" titleVi="Tin nổi bật">
        {/* `featured` is written only by the admin listings route (action 'feature'); no payment path
            touches it. FEATURED_BOOST_PCT is derived from RANK.FEATURED_BOOST. ⚠️ The rule only — see the
            header for why there is no "none today" and no promised label. */}
        <p>
          {tr(
            `Featured placement is assigned by the ${SITE_NAME} team. It is never sold, and no payment is taken for it. A featured listing gets a fixed, disclosed boost of ${FEATURED_BOOST_PCT}% added to its score — the same for every featured listing.`,
            `Vị trí tin nổi bật do đội ngũ ${SITE_NAME} chỉ định. Vị trí này không bao giờ được bán và không nhận bất kỳ khoản thanh toán nào. Tin nổi bật được cộng thêm ${FEATURED_BOOST_PCT}% vào điểm xếp hạng — mức cố định, được công bố, như nhau với mọi tin nổi bật.`,
          )}
        </p>
      </ContentSection>

      <ContentSection id="commission" title="Ads and commission" titleVi="Quảng cáo và hoa hồng">
        {/* browseRankScore() (src/lib/ranking-formula.ts) takes trust, recency, featured and demand —
            nothing about commission. */}
        <p>
          {tr(
            'Some linked listings and partner links can earn us a commission when you buy through them. They carry an “Ad” label and a note saying so. Whether a listing can earn us a commission is not part of its score: it neither raises nor lowers its position.',
            'Một số tin đăng liên kết và đường dẫn của đối tác có thể mang lại hoa hồng cho chúng tôi khi bạn mua hàng qua đó. Các tin, đường dẫn này có nhãn “Quảng cáo” kèm ghi chú về việc đó. Việc một tin có thể mang lại hoa hồng hay không không nằm trong điểm xếp hạng: nó không làm tin được xếp cao hơn hay thấp hơn.',
          )}
        </p>
      </ContentSection>

      <ContentSection id="not-used" title="What we do not use" titleVi="Điều chúng tôi không dùng">
        <p>
          {tr(
            'Category browsing and search results are not reordered using your personal data, your browsing history, demographics, nationality or device. Two people running the same search at the same moment see the same order. The only exceptions are the For You and Recently viewed rails above, and only while personalisation is on.',
            'Kết quả duyệt danh mục và kết quả tìm kiếm không được sắp xếp lại dựa trên dữ liệu cá nhân, lịch sử duyệt web, nhân khẩu học, quốc tịch hay thiết bị của bạn. Hai người tìm cùng một từ khoá tại cùng một thời điểm sẽ thấy cùng một thứ tự. Ngoại lệ duy nhất là hai mục “Dành cho bạn” và “Đã xem gần đây” nêu trên, và chỉ khi cá nhân hoá đang bật.',
          )}
        </p>
      </ContentSection>

      <ContentSection id="your-score" title="Your own trust score" titleVi="Điểm uy tín của bạn">
        <p>
          {/* ⚠️ DESCRIBE ONLY WHAT SHIPS. An earlier draft promised "see every event that changed
              your score in your dashboard, and dispute any event" — neither surface exists (there
              is no TrustEvent history UI under /dashboard). codex caught it. On an ordinary page
              that is marketing overreach; on a page published under Luật TMĐT 122/2025 as a
              statement about our own system, it is a false representation. If the history and
              dispute surfaces get built, extend this — never the other way round. */}
          {tr(
            'If you sell here, your trust score is built from evidence — completed transactions, buyer reviews, how quickly you reply, whether your identity is verified, and any confirmed reports against you. It is never adjusted by payment. If you believe your score is wrong, contact support and we will review it.',
            'Nếu bạn là người bán, điểm uy tín của bạn được xây dựng từ bằng chứng — giao dịch đã hoàn tất, đánh giá của người mua, tốc độ phản hồi, danh tính đã xác minh, và các báo cáo đã được xác nhận. Điểm này không bao giờ thay đổi vì lý do thanh toán. Nếu bạn cho rằng điểm của mình chưa chính xác, vui lòng liên hệ bộ phận hỗ trợ để được xem xét.',
          )}
        </p>
      </ContentSection>
    </ContentPage>
  )
}
