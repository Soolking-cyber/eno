import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import { withShare } from '@/lib/site-identity'
import { Tr } from '@/context/language-context'
import { ContentPage, ContentSection } from '@/components/marketplace/content-page'
import { LegalLanguageNote } from '@/components/legal/legal-language-note'
import { COMPANY } from '@/lib/site-legal'
import { AD_QUESTIONS, AD_QUESTION_KEYS, PERMIT_CLASSES } from '@/lib/ads/review-jev'
import { REVIEW_REASONS } from '@/lib/ads/review-reasons'
import { AD_CREATIVE_LABEL } from '@/lib/ads/creative-card'
import { AD_FIELD_LIMITS, AD_IMAGE_ASPECT, AD_IMAGE_MIN_EDGE } from '@/lib/ads/creative-review'
import { AD_CREATIVE_MAX_HOURS } from '@/lib/ads/book'

export const metadata: Metadata = withShare({
  title: `Advertising policy | Chính sách quảng cáo | ${SITE_NAME}`,
  description: `Where ads appear on ${SITE_NAME}, what is never accepted under Vietnamese law, the review every ad passes before payment, and removal and refunds.`,
  alternates: { canonical: '/advertising-policy' },
})

// ── THE ADVERTISING POLICY (owner 2026-11-25: "enable any type of ads except the restricted ones by vietnamese law, jev
// should check before they pay … standardized places where they show up"; permit classes allowed, any language).
// ⛔ THE RULES ARE THE CODE'S, NOT A COPY OF THEM: the refused classes come from the review's own questions and reasons
// (src/lib/ads/review-jev.ts, review-reasons.ts), the sizes from creative-review.ts, the label from creative-card.ts — so
// this page cannot promise a rule the review does not apply, or miss one it does.
// ⚠️ RENDERS ON BOTH EDITIONS, like /prohibited: every string is true on both (the site names itself through SITE_NAME).
// Curated Vietnamese, rendered on the server: each pair's `vi` prints for a Vietnamese reader, `en` (and the nine
// machine-translated languages) go through <Tr text={en}> — variables, so scripts/gen-ui-strings.mjs harvests none of it.
// ⛔ DRAFT FOR COUNSEL, like the other legal pages (<LegalLanguageNote />).

type Pair = { en: string; vi: string }
const P = (en: string, vi: string): Pair => ({ en, vi })

const INTRO = P(
  `Any lawful business with a shop on ${SITE_NAME} can advertise. This page says where ads appear, what is never accepted, how every ad is checked before anything is paid, and when ${SITE_NAME} removes one.`,
  `Mọi doanh nghiệp hợp pháp có cửa hàng trên ${SITE_NAME} đều có thể quảng cáo. Trang này nêu vị trí hiển thị quảng cáo, nội dung không bao giờ được chấp nhận, cách mỗi quảng cáo được kiểm duyệt trước khi thanh toán, và khi nào ${SITE_NAME} gỡ quảng cáo.`,
)

const PLACEMENT: Pair[] = [
  P(
    `Your own ad appears in one standard place: the first card on page one of the home feed, category and search results, in the grid view, the same size as the listing cards around it. It is labelled "${AD_CREATIVE_LABEL}" in every language.`,
    `Quảng cáo của bạn hiển thị ở một vị trí chuẩn duy nhất: thẻ đầu tiên của trang một trên bảng tin trang chủ, trang danh mục và kết quả tìm kiếm, ở chế độ lưới, cùng kích thước với các thẻ tin đăng xung quanh. Quảng cáo luôn được gắn nhãn "${AD_CREATIVE_LABEL}" ở mọi ngôn ngữ.`,
  ),
  P(
    `The whole card links to your own https web page, opened in a new tab and marked as a paid link. One purchase runs for 1 to ${AD_CREATIVE_MAX_HOURS} hours; ads running at the same time take turns in the slot.`,
    `Toàn bộ thẻ dẫn đến trang web https của chính bạn, mở trong thẻ mới và được đánh dấu là liên kết trả phí. Mỗi lần mua chạy từ 1 đến ${AD_CREATIVE_MAX_HOURS} giờ; các quảng cáo chạy cùng lúc luân phiên hiển thị ở vị trí này.`,
  ),
  P(
    'A shop can also promote one of its own live listings: it is shown first, labelled "Ad", in matching search and category results.',
    'Cửa hàng cũng có thể quảng bá một tin đăng đang hiển thị của mình: tin được hiển thị đầu tiên, gắn nhãn "Quảng cáo", trong kết quả tìm kiếm và danh mục phù hợp.',
  ),
]

const CREATIVE: Pair[] = [
  P(
    `A square picture: JPEG, PNG or WebP, at least ${AD_IMAGE_MIN_EDGE} × ${AD_IMAGE_MIN_EDGE} pixels, width to height between ${AD_IMAGE_ASPECT.min} and ${AD_IMAGE_ASPECT.max}, up to 5 MB. ${SITE_NAME} keeps its own copy of the picture it reviewed, so what runs is what was checked.`,
    `Một ảnh vuông: JPEG, PNG hoặc WebP, tối thiểu ${AD_IMAGE_MIN_EDGE} × ${AD_IMAGE_MIN_EDGE} điểm ảnh, tỉ lệ rộng trên cao từ ${String(AD_IMAGE_ASPECT.min).replace('.', ',')} đến ${String(AD_IMAGE_ASPECT.max).replace('.', ',')}, tối đa 5 MB. ${SITE_NAME} lưu bản sao của chính ảnh đã được kiểm duyệt, nên nội dung hiển thị đúng là nội dung đã được kiểm tra.`,
  ),
  P(
    `A headline of up to ${AD_FIELD_LIMITS.headline} characters and an optional line of up to ${AD_FIELD_LIMITS.body}, in any language: each viewer reads them machine-translated into their own. The picture and your name are shown as they are.`,
    `Một tiêu đề tối đa ${AD_FIELD_LIMITS.headline} ký tự và một dòng mô tả tùy chọn tối đa ${AD_FIELD_LIMITS.body} ký tự, bằng bất kỳ ngôn ngữ nào: mỗi người xem đọc bản dịch máy sang ngôn ngữ của họ. Ảnh và tên của bạn được giữ nguyên.`,
  ),
  P(
    `The name shown on the card (up to ${AD_FIELD_LIMITS.advertiserName} characters) and a landing page that is a web page over https, not a file to download.`,
    `Tên hiển thị trên thẻ (tối đa ${AD_FIELD_LIMITS.advertiserName} ký tự) và một trang đích là trang web qua https, không phải tệp để tải về.`,
  ),
]

const IDENTITY = P(
  `Every ad records the advertiser's registered legal name and tax code (MST), as Vietnam's Advertising Law asks of whoever publishes an ad. The advertiser is responsible for the content of its ad and of the page it links to.`,
  'Mỗi quảng cáo đều lưu tên pháp lý đã đăng ký và mã số thuế (MST) của bên quảng cáo, theo yêu cầu của Luật Quảng cáo đối với bên phát hành quảng cáo. Bên quảng cáo chịu trách nhiệm về nội dung quảng cáo và trang mà quảng cáo dẫn đến.',
)

/** The refusing classes, in the review's own words (review-reasons.ts) — the Vietnamese is curated there. */
const refusal = (family: 'banned' | 'claim'): Pair[] =>
  AD_QUESTION_KEYS.filter((k) => AD_QUESTIONS[k].family === family).map((k) => {
    const code = (AD_QUESTIONS[k] as { refusal: keyof typeof REVIEW_REASONS }).refusal
    return REVIEW_REASONS[code]
  })

const PERMIT_NAMES: Record<string, Pair> = {
  medicine: P('medicines', 'thuốc'),
  cosmetics: P('cosmetics', 'mỹ phẩm'),
  supplements: P('food supplements and functional food', 'thực phẩm bảo vệ sức khỏe, thực phẩm chức năng'),
  medical: P('medical devices and medical services', 'trang thiết bị y tế và dịch vụ khám chữa bệnh'),
  finance: P('banking, credit, insurance and investment', 'ngân hàng, tín dụng, bảo hiểm và đầu tư'),
  real_estate_project: P('real-estate projects', 'dự án bất động sản'),
  study_work_abroad: P('study and work abroad', 'du học và đưa người lao động đi làm việc ở nước ngoài'),
  pesticides: P('pesticides', 'thuốc bảo vệ thực vật'),
  veterinary: P('veterinary drugs', 'thuốc thú y'),
  fertiliser: P('fertiliser', 'phân bón'),
  household_insecticide: P('household insecticides and disinfectants', 'chế phẩm diệt côn trùng, diệt khuẩn gia dụng'),
}
const PERMIT_LIST: Pair = {
  en: PERMIT_CLASSES.map((k) => PERMIT_NAMES[k]?.en ?? k).join(', '),
  vi: PERMIT_CLASSES.map((k) => PERMIT_NAMES[k]?.vi ?? k).join(', '),
}
const PERMIT = P(
  `Ads in sectors that Vietnamese law regulates are accepted: ${PERMIT_LIST.en}. In these sectors the advertiser must hold the ad-content confirmation or licence the law requires before the ad runs, and can give its number with the ad (up to ${AD_FIELD_LIMITS.permitRef} characters); ${SITE_NAME}'s reviewers see it with the ad.`,
  `Quảng cáo trong các lĩnh vực có điều kiện theo pháp luật Việt Nam được chấp nhận: ${PERMIT_LIST.vi}. Trong các lĩnh vực này, bên quảng cáo phải có giấy xác nhận nội dung quảng cáo hoặc giấy phép theo quy định trước khi quảng cáo chạy, và có thể ghi số của giấy đó kèm quảng cáo (tối đa ${AD_FIELD_LIMITS.permitRef} ký tự); bộ phận kiểm duyệt của ${SITE_NAME} xem được số này cùng quảng cáo.`,
)

const REVIEW: Pair[] = [
  P(
    'Before any price is offered, every ad is checked automatically: its words, its picture and the page it links to, against the rules above, by a list of banned terms and by AI models. Nothing is paid for an ad that is refused; the answer gives each reason in English and Vietnamese.',
    'Trước khi báo giá, mỗi quảng cáo đều được kiểm duyệt tự động: nội dung chữ, hình ảnh và trang đích, theo các quy định trên, bằng danh sách từ khóa cấm và bằng các mô hình AI. Quảng cáo bị từ chối không phải thanh toán; câu trả lời nêu từng lý do bằng tiếng Anh và tiếng Việt.',
  ),
  P(
    'If the review cannot run (a service is down), nothing can be paid for until it can. The same ad sent again within 24 hours gets the same answer. An approval can be bought on for a week; after that the ad is reviewed again.',
    'Nếu chưa thể kiểm duyệt (một dịch vụ gặp sự cố), sẽ không thể thanh toán cho đến khi kiểm duyệt được. Cùng một quảng cáo gửi lại trong vòng 24 giờ nhận cùng kết quả. Một quảng cáo đã được duyệt có thể được mua tiếp trong một tuần; sau đó quảng cáo được kiểm duyệt lại.',
  ),
]

const PAYMENT = P(
  `Ads are paid in USDC over x402. You are charged when the payment settles, and the ad starts running then. If ${SITE_NAME} removes an ad after its payment settled but before it started, the payment is refunded by hand.`,
  `Quảng cáo được thanh toán bằng USDC qua x402. Bạn bị trừ tiền khi giao dịch thanh toán hoàn tất, và quảng cáo bắt đầu chạy từ lúc đó. Nếu ${SITE_NAME} gỡ một quảng cáo sau khi thanh toán đã hoàn tất nhưng trước khi quảng cáo bắt đầu chạy, khoản thanh toán được hoàn lại thủ công.`,
)

const REMOVAL = P(
  `${SITE_NAME} may remove any ad that breaks Vietnamese law or this policy, at any time; it stops showing within about a minute. For the unused part of a removed ad's run, a pro-rata refund is made on request to ${COMPANY.email}. An ad that a competent state authority identifies as unlawful is removed within 24 hours of the request. A removed ad cannot be submitted again.`,
  `${SITE_NAME} có thể gỡ bất kỳ quảng cáo nào vi phạm pháp luật Việt Nam hoặc chính sách này vào bất kỳ lúc nào; quảng cáo ngừng hiển thị trong khoảng một phút. Phần thời gian chưa chạy của quảng cáo bị gỡ được hoàn tiền theo tỉ lệ khi có yêu cầu gửi đến ${COMPANY.email}. Quảng cáo bị cơ quan nhà nước có thẩm quyền xác định là vi phạm pháp luật được gỡ trong vòng 24 giờ kể từ khi nhận được yêu cầu. Quảng cáo đã bị gỡ không thể được gửi lại.`,
)

const FIGURES = P(
  'Each ad has live figures, to the advertising industry\'s standard: an impression counts when at least half the card is on screen for one second; clicks include middle clicks; each counts once per browser session every 30 minutes; bots, prefetches and other invalid traffic are counted apart, never as views. They are on your dashboard at /dashboard/ads and in the API.',
  'Mỗi quảng cáo có số liệu cập nhật liên tục theo chuẩn ngành quảng cáo: một lượt hiển thị được tính khi ít nhất một nửa thẻ nằm trên màn hình trong một giây; lượt nhấp gồm cả nhấp chuột giữa; mỗi loại được tính một lần cho mỗi phiên trình duyệt trong 30 phút; bot, tải trước và lưu lượng không hợp lệ khác được tính riêng, không bao giờ được tính là lượt xem. Số liệu có trên trang quản lý tại /dashboard/ads và qua API.',
)

const sections = [
  { id: 'placement', label: 'Where ads appear', labelVi: 'Vị trí hiển thị' },
  { id: 'creative', label: 'What an ad is made of', labelVi: 'Nội dung quảng cáo' },
  { id: 'identity', label: 'Who advertises', labelVi: 'Bên quảng cáo' },
  { id: 'refused', label: 'Never accepted', labelVi: 'Không bao giờ được chấp nhận' },
  { id: 'regulated', label: 'Regulated sectors', labelVi: 'Lĩnh vực có điều kiện' },
  { id: 'review', label: 'Checked before you pay', labelVi: 'Kiểm duyệt trước khi thanh toán' },
  { id: 'payment', label: 'Payment', labelVi: 'Thanh toán' },
  { id: 'removal', label: 'Removal and refunds', labelVi: 'Gỡ quảng cáo và hoàn tiền' },
  { id: 'figures', label: 'Figures', labelVi: 'Số liệu' },
]

export default async function AdvertisingPolicyPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params
  const vi = lang === 'vi'
  const say = (p: Pair) => (vi ? p.vi : <Tr text={p.en} />)
  const list = (items: Pair[]) => (
    <ul className="list-disc space-y-1.5 pl-5 text-base leading-relaxed text-body">
      {items.map((it) => <li key={it.en}>{say(it)}</li>)}
    </ul>
  )
  const para = (p: Pair) => <p className="text-base leading-relaxed text-body">{say(p)}</p>
  return (
    <ContentPage title="Advertising policy" titleVi="Chính sách quảng cáo" meta={<LegalLanguageNote />} intro={say(INTRO)} sections={sections}>
      <ContentSection id="placement" title="Where ads appear" titleVi="Vị trí hiển thị">{list(PLACEMENT)}</ContentSection>
      <ContentSection id="creative" title="What an ad is made of" titleVi="Nội dung quảng cáo">{list(CREATIVE)}</ContentSection>
      <ContentSection id="identity" title="Who advertises" titleVi="Bên quảng cáo">{para(IDENTITY)}</ContentSection>
      <ContentSection id="refused" title="Never accepted" titleVi="Không bao giờ được chấp nhận">
        {list(refusal('banned'))}
        {para(P('Nor these claims (Article 8 of the Advertising Law, and misleading claims):', 'Cũng không chấp nhận các nội dung sau (Điều 8 Luật Quảng cáo, và nội dung gây hiểu lầm):'))}
        {list(refusal('claim'))}
      </ContentSection>
      <ContentSection id="regulated" title="Regulated sectors" titleVi="Lĩnh vực có điều kiện">{para(PERMIT)}</ContentSection>
      <ContentSection id="review" title="Checked before you pay" titleVi="Kiểm duyệt trước khi thanh toán">{list(REVIEW)}</ContentSection>
      <ContentSection id="payment" title="Payment" titleVi="Thanh toán">{para(PAYMENT)}</ContentSection>
      <ContentSection id="removal" title="Removal and refunds" titleVi="Gỡ quảng cáo và hoàn tiền">{para(REMOVAL)}</ContentSection>
      <ContentSection id="figures" title="Figures" titleVi="Số liệu">{para(FIGURES)}</ContentSection>
    </ContentPage>
  )
}
