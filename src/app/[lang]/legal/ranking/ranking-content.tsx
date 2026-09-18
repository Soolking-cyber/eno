'use client'

// ── Search & ranking transparency, the rendered copy ─────────────────────────────────────────────
//
// Required disclosure of the main ranking parameters and their relative importance
// (Luật Thương mại điện tử 122/2025/QH15). Architecture: docs/compliance-2026.md §4.1.
//
// ⚠️ THIS IS A CLIENT COMPONENT ON PURPOSE, so every sentence can use `tr(en, vi)` with CURATED
// Vietnamese. The machine-translation path is fine for product copy and wrong here: this text is a
// legal statement about our own ranker, served to Vietnamese regulators and users, and a machine
// rendering of "buyer interest saturates" is not something we want to discover after the fact.
//
// ⚠️ NOT ONE NUMBER ON THIS PAGE IS TYPED BY HAND. They all come from
// `@/lib/compliance/ranking-disclosure`, which derives them from the live `RANK` constants, and
// `ranking-disclosure.test.ts` fails the build if the two diverge. To change a percentage here,
// change the ranker — that is the entire point of the control.

import { useLanguage } from '@/context/language-context'
import { ContentPage, ContentSection } from '@/components/marketplace/content-page'
import { SITE_NAME } from '@/lib/edition'
import { LEGAL_BASIS } from '@/lib/compliance/legal-basis'
import {
  browseFactors,
  searchFactors,
  FEATURED_BOOST_PCT,
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

export function RankingContent() {
  const { tr } = useLanguage()
  return (
    <ContentPage
      title={tr('How we rank results', 'Cách chúng tôi sắp xếp kết quả')}
      meta={tr(
        `Published under ${LEGAL_BASIS.ecommerceLaw.en}`,
        `Công bố theo ${LEGAL_BASIS.ecommerceLaw.vi}`,
      )}
      intro={tr(
        `${SITE_NAME} does not sell placement. No listing appears higher because someone paid for it, and no result is reordered based on who you are.`,
        `${SITE_NAME} không bán vị trí hiển thị. Không tin đăng nào được xếp hạng cao hơn nhờ trả phí, và kết quả không được sắp xếp lại dựa trên việc bạn là ai.`,
      )}
      sections={[
        { id: 'browse', label: tr('Browsing', 'Khi duyệt') },
        { id: 'search', label: tr('Searching', 'Khi tìm kiếm') },
        { id: 'featured', label: tr('Featured listings', 'Tin nổi bật') },
        { id: 'not-used', label: tr('What we do not use', 'Điều chúng tôi không dùng') },
        { id: 'your-score', label: tr('Your own score', 'Điểm của bạn') },
      ]}
    >
      <ContentSection id="browse" title={tr('When you browse a category', 'Khi bạn duyệt một danh mục')}>
        <p>
          {tr(
            'With no search query, the order is a single weighted score. Seller trust leads, buyer interest follows, and freshness breaks ties:',
            'Khi không có từ khoá tìm kiếm, thứ tự được tính bằng một điểm tổng hợp có trọng số. Điểm tin cậy của người bán dẫn đầu, tiếp đến là mức độ quan tâm của người mua, và độ mới dùng để phân định:',
          )}
        </p>
        <FactorList factors={browseFactors()} />
      </ContentSection>

      <ContentSection id="search" title={tr('When you search', 'Khi bạn tìm kiếm')}>
        <p>
          {tr(
            'Once you type a query, matching what you asked for takes the lead — a trusted seller with the wrong item does not help you — but trust remains a heavyweight co-factor:',
            'Khi bạn nhập từ khoá, mức độ phù hợp với yêu cầu của bạn được ưu tiên — một người bán uy tín nhưng không đúng món hàng thì không giúp được gì — nhưng điểm tin cậy vẫn là yếu tố quan trọng:',
          )}
        </p>
        <FactorList factors={searchFactors()} />
      </ContentSection>

      <ContentSection id="featured" title={tr('Featured listings', 'Tin nổi bật')}>
        <p>
          {tr(
            `Featured listings receive a fixed, disclosed boost of ${FEATURED_BOOST_PCT}% added to their score, and are always visibly labelled. The boost is identical for every featured listing and cannot be increased by paying more.`,
            `Tin nổi bật được cộng thêm ${FEATURED_BOOST_PCT}% vào điểm xếp hạng — mức cố định, được công bố — và luôn được gắn nhãn rõ ràng. Mức cộng này giống nhau cho mọi tin nổi bật và không thể tăng thêm bằng cách trả nhiều tiền hơn.`,
          )}
        </p>
      </ContentSection>

      <ContentSection id="not-used" title={tr('What we do not use', 'Điều chúng tôi không dùng')}>
        <p>
          {tr(
            'We do not reorder results using your personal data, browsing history, demographics, nationality, or device. Two people running the same search at the same moment see the same order.',
            'Chúng tôi không sắp xếp lại kết quả dựa trên dữ liệu cá nhân, lịch sử duyệt web, nhân khẩu học, quốc tịch hay thiết bị của bạn. Hai người tìm cùng một từ khoá tại cùng một thời điểm sẽ thấy cùng một thứ tự.',
          )}
        </p>
      </ContentSection>

      <ContentSection id="your-score" title={tr('Your own trust score', 'Điểm tin cậy của bạn')}>
        <p>
          {/* ⚠️ DESCRIBE ONLY WHAT SHIPS. An earlier draft promised "see every event that changed
              your score in your dashboard, and dispute any event" — neither surface exists (there
              is no TrustEvent history UI under /dashboard). codex caught it. On an ordinary page
              that is marketing overreach; on a page published under Luật TMĐT 122/2025 as a
              statement about our own system, it is a false representation. If the history and
              dispute surfaces get built, extend this — never the other way round. */}
          {tr(
            'If you sell here, your trust score is built from evidence — completed transactions, buyer reviews, how quickly you reply, whether your identity is verified, and any confirmed reports against you. It is never adjusted by payment. If you believe your score is wrong, contact support and we will review it.',
            'Nếu bạn là người bán, điểm tin cậy của bạn được xây dựng từ bằng chứng — giao dịch đã hoàn tất, đánh giá của người mua, tốc độ phản hồi, danh tính đã xác minh, và các báo cáo đã được xác nhận. Điểm này không bao giờ thay đổi vì lý do thanh toán. Nếu bạn cho rằng điểm của mình chưa chính xác, vui lòng liên hệ bộ phận hỗ trợ để được xem xét.',
          )}
        </p>
      </ContentSection>
    </ContentPage>
  )
}
