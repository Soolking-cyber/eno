/**
 * ⚠️ KEEP `revalidate` — the same reason /terms carries it. Nothing on this page is time-derived
 * today, but it is a LEGAL page, and src/lib/edition.ts records twice what a prerendered legal page
 * costs when a value inside it goes stale or an edition gate arrives too late to reach on-disk HTML.
 */
export const revalidate = 3600

import type { Metadata } from 'next'
import { withShare } from '@/lib/site-identity'
import { SITE_NAME } from '@/lib/edition'
import { Tr } from '@/context/language-context'
import { ContentPage, ContentSection } from '@/components/marketplace/content-page'
import { LinkifiedTr } from '@/components/marketplace/linkified-tr'
import { linkifyLegal } from '@/components/marketplace/legal-linkify'
import { Bilingual } from '@/components/marketplace/bilingual'
import { LegalLanguageNote } from '@/components/legal/legal-language-note'
import { COMPANY, OPERATOR_REGISTERED } from '@/lib/site-legal'
import { AMENDED } from '@/lib/compliance/legal-amendment'

// ── Returns and exchanges ───────────────────────────────────────────────────────────────
//
// ⛔ THIS PAGE EXISTS BECAUSE GOOGLE MERCHANT CENTER REFUSES TO VERIFY A STORE WITHOUT ONE, AND
// THAT IS EXACTLY WHY IT HAS TO BE TRUE RATHER THAN CONVENIENT. Merchant Center's Returns setup
// demands a "Return policy URL … needed for Merchant Center verification", and the obvious move —
// publish a generic 30-day no-questions policy so the form goes green — would have this marketplace
// promising, on behalf of sellers it does not employ, something none of them agreed to. On a
// licensed sàn TMĐT in Vietnam that is a consumer-protection exposure, not a growth hack.
//
// ⛔ THE SCOPE NARROWED IN 2026-10 (dates: LEGAL_AMENDMENT, src/lib/compliance/legal-amendment.ts), AND THE OLD ONE WAS
// THE EXPOSURE ABOVE. The 2026-09-17 wording bound "the verified business storefronts whose
// catalogues appear in product listings and in shopping results" to a 7-day no-reason return. Those
// storefronts are linked/affiliate merchants (Tiki, CellphoneS, FPT Shop…): none of them agreed to
// it, their purchases happen on their own sites, and their listing pages already say eno cannot
// refund. The commitment now binds only BUSINESS SELLERS THAT SELL THROUGH CHAT HERE AND HAVE
// ACCEPTED THIS POLICY; a linked listing follows its own shop's policy. "Required to honour" is kept
// only for sellers who accepted — nobody else ever agreed to be bound.
// ⚠️ THERE IS NO IN-APP ACCEPTANCE RECORD YET (no schema field, no UI). Until one exists, acceptance
// is whatever the operator agrees with a seller in writing, which is why the page tells a buyer to
// ask the seller in chat rather than pointing at a badge that does not exist.
//
// ⚠️ THE MERCHANT CENTER FORM MUST BE RE-CHECKED AGAINST THIS. Google's three steps ask for country,
// returns yes/no, exchanges yes/no, condition + window, and method + fees, and the account-level
// return policy is what applies to the shopping feed (src/lib/listing-jsonld.ts). The feed's
// products are mostly linked shops' items, which this page no longer covers — the form and this page
// have to agree, so change one and change the other in the same sitting.
//
// ⚠️ NO COMPANY NAME, ERC OR NUMBER IS TYPED HERE — COMPANY comes from src/lib/site-legal.ts, and
// `OPERATOR_REGISTERED` forks the operator sentence exactly as /terms does. eno.forum's operator is
// still unincorporated; asserting eno.vn's company on that edition would misstate who is legally
// responsible for this promise.
//
// ⚠️ EDITION-NEUTRAL BY CONSTRUCTION. This route compiles on BOTH builds, so no word here may name
// a visa, an itinerary or PayPal. The subject is physical goods sold by storefronts, which is
// common ground; keep it that way rather than adding a gate.
//
// ⚠️ CURATED VIETNAMESE, RENDERED ON THE SERVER (2026-10-01). It used to be the English source
// through `<Tr>` under a note declaring the English authoritative — VI_OVERRIDES is keyed on the exact
// English, and every paragraph interpolates SITE_NAME, so an override could not be written per
// edition. Each paragraph is now an {en, vi} pair (the /regulations shape): the `vi` variant renders
// the curated text into the server HTML; `en` and the nine machine-translated languages keep
// <LinkifiedTr> over the English. Which language governs is LegalLanguageNote's call.

/** The published window, in days. ⚠️ Named because the copy, the FAQ and the Merchant Center form
 *  all have to say the same number, and a literal typed three times drifts on the first edit. */
const WINDOW_DAYS = 7

export const metadata: Metadata = withShare({
  // ⚠️ SENTENCE CASE, MATCHING THE H1. /terms keeps its title and its H1 identical for the same reason.
  title: `Returns and exchanges | ${SITE_NAME}`,
  description: `How returns and exchanges work on ${SITE_NAME}: a ${WINDOW_DAYS}-day window on items bought from business sellers that sell through chat here and have accepted this policy, who pays return shipping, how to start a return, why linked listings follow the source shop's own policy, and what private person-to-person sales mean for buyers.`,
  alternates: { canonical: '/returns' },
})

type Para = { en: string; vi: string }
type Section = { id: string; title: string; titleVi: string; paras: Para[] }

// ⚠️ THE OPERATOR SENTENCE FORKS, AND IT IS NOT A FORMALITY — see the identical note in /terms.
const operatorPara: Para = OPERATOR_REGISTERED
  ? {
      en: `${SITE_NAME} is an online classifieds marketplace operated by ${COMPANY.name} (${COMPANY.nameEn}), business registration no. ${COMPANY.erc} (${COMPANY.ercIssued}). This policy applies to purchases made in Vietnam.`,
      vi: `${SITE_NAME} là chợ rao vặt trực tuyến do ${COMPANY.name} (${COMPANY.nameEn}) vận hành, Giấy chứng nhận đăng ký doanh nghiệp số ${COMPANY.erc} (cấp ngày ${COMPANY.ercIssued}). Chính sách này áp dụng cho giao dịch mua hàng tại Việt Nam.`,
    }
  : {
      en: `${SITE_NAME} is an online classifieds marketplace for people living in, moving to and visiting Vietnam. The operating company is currently being registered; its registered name and business registration number will be published here and in the Operating Regulations as soon as the certificate is issued. This policy applies to purchases made in Vietnam.`,
      vi: `${SITE_NAME} là chợ rao vặt trực tuyến dành cho người đang sinh sống, chuẩn bị chuyển đến hoặc đến thăm Việt Nam. Công ty vận hành hiện đang làm thủ tục đăng ký thành lập; tên đăng ký và số giấy chứng nhận đăng ký doanh nghiệp sẽ được công bố tại đây và trong Quy chế hoạt động ngay khi giấy chứng nhận được cấp. Chính sách này áp dụng cho giao dịch mua hàng tại Việt Nam.`,
    }

const sections: Section[] = [
  {
    id: 'who',
    title: 'Who this policy covers',
    titleVi: 'Chính sách này áp dụng cho ai',
    paras: [
      operatorPara,
      {
        en: `${SITE_NAME} does not sell anything itself. There is no checkout on this site: every item is offered by the person or business that listed it — or, for a linked listing, by the seller on its source site — and the money passes between buyer and seller directly. That shapes everything below, so it is worth stating plainly before the rules rather than in a footnote after them.`,
        vi: `${SITE_NAME} không tự bán bất kỳ hàng hoá nào. Website không có chức năng thanh toán: mọi món hàng do chính cá nhân hoặc doanh nghiệp đăng tin chào bán — hoặc, với tin đăng liên kết, do người bán trên trang nguồn chào bán — và tiền được chuyển trực tiếp giữa người mua và người bán. Điều này chi phối toàn bộ nội dung dưới đây, nên cần nói rõ ngay từ đầu thay vì để trong phần chú thích.`,
      },
      {
        en: `The ${WINDOW_DAYS}-day commitment on this page applies only to purchases from a business seller that sells through chat on ${SITE_NAME} and has accepted this policy with us. Where you buy from such a seller, the terms on this page apply to your purchase and the seller is required to honour them. Before you pay, you can ask the seller in the chat whether it has accepted this policy.`,
        vi: `Cam kết ${WINDOW_DAYS} ngày trên trang này chỉ áp dụng cho giao dịch mua từ người bán là doanh nghiệp bán hàng qua kênh nhắn tin trên ${SITE_NAME} và đã chấp nhận chính sách này với chúng tôi. Khi bạn mua từ người bán như vậy, các điều kiện trên trang này áp dụng cho giao dịch của bạn và người bán có nghĩa vụ thực hiện. Trước khi thanh toán, bạn có thể hỏi người bán ngay trong cuộc trò chuyện xem họ đã chấp nhận chính sách này hay chưa.`,
      },
      {
        en: `A linked listing — one whose button takes you to its source site, such as an online shop, to buy or pay there — is not covered by this page. That purchase is made with the seller on the source site and follows that seller's own returns and refund policy; ${SITE_NAME} cannot accept the return or make the refund.`,
        vi: `Tin đăng liên kết — loại tin có nút đưa bạn sang trang nguồn, chẳng hạn một cửa hàng trực tuyến, để mua hoặc thanh toán tại đó — không thuộc phạm vi của trang này. Giao dịch đó được thực hiện với người bán trên trang nguồn và tuân theo chính sách đổi trả, hoàn tiền của chính người bán đó; ${SITE_NAME} không thể nhận lại hàng hay hoàn tiền thay họ.`,
      },
      {
        en: `A listing posted by a private individual is a person-to-person sale, and this policy gives it no return right — nor does it to a business seller that has not accepted it, whose own terms apply. Inspect the item, test it, and agree the price before any money changes hands. If something goes wrong afterwards you can still open a case in the Dispute Center, and we can act against a seller who misrepresented what they sold — but we cannot compel a seller to take an item back. Your rights under Vietnamese law apply whoever you buy from.`,
        vi: `Tin do cá nhân đăng là giao dịch mua bán giữa cá nhân với nhau, và chính sách này không tạo ra quyền đổi trả cho giao dịch đó — tương tự với người bán là doanh nghiệp chưa chấp nhận chính sách, khi đó điều kiện riêng của họ được áp dụng. Hãy kiểm tra, dùng thử món hàng và thống nhất giá trước khi trả tiền. Nếu sau đó có vấn đề, bạn vẫn có thể mở hồ sơ tại Trung tâm giải quyết tranh chấp, và chúng tôi có thể xử lý người bán đã mô tả sai hàng hoá — nhưng chúng tôi không thể buộc người bán nhận lại hàng. Dù bạn mua của ai, các quyền của bạn theo pháp luật Việt Nam vẫn được giữ nguyên.`,
      },
    ],
  },
  {
    id: 'window',
    title: 'Your return window',
    titleVi: 'Thời hạn đổi trả',
    paras: [
      {
        en: `You have ${WINDOW_DAYS} days from the day you receive an item bought from a seller covered by this policy to return it. The window covers both faulty items and items you simply do not want, and it runs from delivery or collection, not from the order date.`,
        vi: `Bạn có ${WINDOW_DAYS} ngày kể từ ngày nhận hàng để trả lại món hàng đã mua từ người bán thuộc phạm vi chính sách này. Thời hạn này áp dụng cho cả hàng bị lỗi lẫn hàng bạn không còn muốn dùng, và được tính từ ngày giao hoặc nhận hàng, không phải từ ngày đặt mua.`,
      },
      {
        en: `To be returned, an item must be complete — accessories, cables, manuals, free gifts and original packaging — and in the condition you received it, beyond whatever handling was needed to check that it works. An item that has been installed, activated, modified or damaged after delivery is outside this policy.`,
        vi: `Hàng trả lại phải còn đầy đủ — phụ kiện, dây cáp, sách hướng dẫn, quà tặng kèm và bao bì gốc — và trong tình trạng như khi bạn nhận, ngoài những thao tác cần thiết để kiểm tra hàng hoạt động. Hàng đã được lắp đặt, kích hoạt, sửa đổi hoặc bị hư hỏng sau khi giao không thuộc phạm vi chính sách này.`,
      },
      {
        en: `Keep proof of purchase. The invoice, the order confirmation or the message thread on ${SITE_NAME} all count; the thread is usually the easiest, because it is already a dated record both sides can see.`,
        vi: `Hãy giữ bằng chứng mua hàng. Hoá đơn, xác nhận đơn hàng hoặc cuộc trò chuyện trên ${SITE_NAME} đều được chấp nhận; cuộc trò chuyện thường là tiện nhất, vì đó đã là một bản ghi có ngày giờ mà cả hai bên đều xem được.`,
      },
    ],
  },
  {
    id: 'fees',
    title: 'Who pays, and what you get back',
    titleVi: 'Ai chịu phí và bạn được hoàn lại những gì',
    paras: [
      {
        en: `If the item is faulty, damaged in transit, incomplete, counterfeit or materially different from its listing, the seller pays the return shipping and you choose between a full refund — including the original delivery charge — a replacement, or a repair under warranty. You are never out of pocket for a seller's mistake.`,
        vi: `Nếu hàng bị lỗi, hư hỏng khi vận chuyển, thiếu bộ phận, là hàng giả hoặc khác đáng kể so với tin đăng, người bán chịu phí gửi trả và bạn được chọn giữa hoàn tiền toàn bộ — bao gồm cả phí giao hàng ban đầu — đổi hàng mới, hoặc sửa chữa theo bảo hành. Bạn không phải chịu thiệt vì lỗi của người bán.`,
      },
      {
        en: `If the item is exactly as described and you have simply changed your mind, the return is still accepted inside the ${WINDOW_DAYS} days, but you pay the return shipping and the original delivery charge is not refunded. The item must be unused and resalable.`,
        vi: `Nếu hàng đúng như mô tả và bạn chỉ đổi ý, việc trả hàng vẫn được chấp nhận trong ${WINDOW_DAYS} ngày, nhưng bạn chịu phí gửi trả và phí giao hàng ban đầu không được hoàn lại. Hàng phải chưa qua sử dụng và còn bán lại được.`,
      },
      {
        en: `Refunds are made by the seller, by the same method you paid, within 7 working days of the item arriving back with them. Because payment on ${SITE_NAME} is arranged directly between buyer and seller, the refund comes from the seller and not from the platform.`,
        vi: `Người bán hoàn tiền bằng đúng phương thức bạn đã thanh toán, trong vòng 7 ngày làm việc kể từ khi nhận lại hàng. Vì việc thanh toán trên ${SITE_NAME} do người mua và người bán tự thực hiện với nhau, tiền hoàn lại do người bán trả, không phải do nền tảng.`,
      },
    ],
  },
  {
    id: 'exchanges',
    title: 'Exchanges',
    titleVi: 'Đổi hàng',
    paras: [
      {
        en: `Sellers covered by this policy accept exchanges on the same ${WINDOW_DAYS}-day window and the same conditions as a return. You can exchange for a different size, colour, configuration or model.`,
        vi: `Người bán thuộc phạm vi chính sách này nhận đổi hàng trong cùng thời hạn ${WINDOW_DAYS} ngày và với cùng điều kiện như trả hàng. Bạn có thể đổi sang kích cỡ, màu sắc, cấu hình hoặc mẫu khác.`,
      },
      {
        en: `Where the replacement costs more, you pay the difference; where it costs less, the difference is refunded to you. If the exchange is because the item was faulty or not as described, the seller covers the shipping in both directions.`,
        vi: `Nếu món hàng đổi sang có giá cao hơn, bạn trả thêm phần chênh lệch; nếu thấp hơn, phần chênh lệch được hoàn lại cho bạn. Nếu việc đổi hàng là do hàng bị lỗi hoặc không đúng mô tả, người bán chịu phí vận chuyển cả hai chiều.`,
      },
    ],
  },
  {
    id: 'how',
    title: 'How to start a return',
    titleVi: 'Cách yêu cầu trả hàng',
    paras: [
      {
        en: `Message the seller from the listing on ${SITE_NAME} and tell them what you are returning and why. Keep it in the in-app thread rather than moving to another app: the thread is timestamped, neither side can edit it, and it is the record we read if the return is ever disputed.`,
        vi: `Hãy nhắn cho người bán từ chính tin đăng trên ${SITE_NAME}, nói rõ bạn trả món hàng nào và vì sao. Hãy giữ trao đổi trong cuộc trò chuyện trên ứng dụng thay vì chuyển sang ứng dụng khác: cuộc trò chuyện có ghi thời gian, không bên nào sửa được, và là bản ghi chúng tôi đọc nếu việc trả hàng phát sinh tranh chấp.`,
      },
      {
        en: `The seller should answer within 3 working days and tell you where to send the item or when they will collect it. If they do not answer, or you cannot agree, open a case in the Dispute Center. We review the thread, the listing and the evidence both sides provide, and we can restrict or remove a seller that accepted this policy and will not honour it.`,
        vi: `Người bán cần trả lời trong vòng 3 ngày làm việc và cho bạn biết gửi hàng về đâu hoặc khi nào họ đến nhận. Nếu người bán không trả lời, hoặc hai bên không thống nhất được, hãy mở hồ sơ tại Trung tâm giải quyết tranh chấp. Chúng tôi xem xét cuộc trò chuyện, tin đăng và bằng chứng của cả hai bên, và có thể hạn chế hoặc gỡ bỏ người bán đã chấp nhận chính sách này nhưng không thực hiện.`,
      },
      {
        en: `You can also write to ${COMPANY.email} if you would rather raise it with us directly. Include the listing link and the seller's name so we can find the thread.`,
        vi: `Bạn cũng có thể gửi email tới ${COMPANY.email} nếu muốn trao đổi trực tiếp với chúng tôi. Hãy gửi kèm đường dẫn tin đăng và tên người bán để chúng tôi tìm được cuộc trò chuyện.`,
      },
    ],
  },
  {
    id: 'exceptions',
    title: 'What cannot be returned',
    titleVi: 'Hàng không áp dụng đổi trả',
    paras: [
      {
        en: `A small set of goods is excluded, for reasons of hygiene, safety or because the item cannot be resold once it has left the seller: food and other perishables; cosmetics, underwear, swimwear and personal-care items once opened or unsealed; items made, engraved or configured to your order; and digital goods or activation codes once they have been delivered or redeemed.`,
        vi: `Một số ít loại hàng không áp dụng, vì lý do vệ sinh, an toàn hoặc vì không thể bán lại sau khi đã rời tay người bán: thực phẩm và hàng dễ hư hỏng; mỹ phẩm, đồ lót, đồ bơi và sản phẩm chăm sóc cá nhân đã mở hoặc đã bóc niêm phong; hàng được làm, khắc hoặc cấu hình theo yêu cầu riêng của bạn; và hàng hoá kỹ thuật số hoặc mã kích hoạt đã được giao hoặc đã sử dụng.`,
      },
      {
        en: `An item sold explicitly as faulty, for parts, or with a disclosed defect cannot be returned for that defect — you agreed the price knowing about it. Any other fault in the same item is still covered.`,
        vi: `Hàng được bán rõ là hàng lỗi, hàng lấy linh kiện hoặc đã công khai khuyết tật thì không được trả lại vì chính khuyết tật đó — bạn đã đồng ý mức giá khi biết rõ điều này. Các lỗi khác của cùng món hàng vẫn được áp dụng chính sách.`,
      },
      {
        en: `Damage caused after delivery — drops, liquid, unauthorised repair, or use outside the manufacturer's instructions — is not a return. Where a manufacturer's warranty applies it is separate from this policy and survives the ${WINDOW_DAYS} days.`,
        vi: `Hư hỏng phát sinh sau khi giao — rơi vỡ, vào nước, sửa chữa không được uỷ quyền hoặc sử dụng sai hướng dẫn của nhà sản xuất — không thuộc trường hợp trả hàng. Bảo hành của nhà sản xuất (nếu có) là chế độ riêng, độc lập với chính sách này và vẫn tiếp tục sau ${WINDOW_DAYS} ngày.`,
      },
    ],
  },
  {
    id: 'rights',
    title: 'Your rights under Vietnamese law',
    titleVi: 'Quyền của bạn theo pháp luật Việt Nam',
    paras: [
      {
        en: `Nothing on this page reduces the rights Vietnamese consumer-protection law gives you, and where the law is more generous than this policy, the law applies. Business sellers owe you the statutory warranty and recall obligations that come with what they sell, and those duties are theirs whatever a listing says.`,
        vi: `Không nội dung nào trên trang này làm giảm các quyền mà pháp luật về bảo vệ quyền lợi người tiêu dùng của Việt Nam dành cho bạn; khi pháp luật có lợi cho bạn hơn chính sách này, quy định của pháp luật được áp dụng. Người bán là doanh nghiệp có nghĩa vụ bảo hành và thu hồi hàng hoá theo luật định đối với hàng mình bán, và nghĩa vụ đó thuộc về họ bất kể tin đăng ghi gì.`,
      },
      {
        en: `You keep the right to complain to the competent consumer-protection authority or to a consumer-protection organisation, and to take a dispute to the courts of Vietnam. Using the Dispute Center first is quicker and usually enough, but it is not a condition of anything above.`,
        vi: `Bạn vẫn có quyền khiếu nại tới cơ quan bảo vệ quyền lợi người tiêu dùng có thẩm quyền hoặc tổ chức bảo vệ quyền lợi người tiêu dùng, và đưa tranh chấp ra Toà án Việt Nam. Sử dụng Trung tâm giải quyết tranh chấp trước thường nhanh hơn và đủ để giải quyết, nhưng đó không phải điều kiện bắt buộc cho bất kỳ quyền nào nêu trên.`,
      },
    ],
  },
  {
    id: 'changes',
    title: 'Changes to this policy',
    titleVi: 'Thay đổi chính sách',
    paras: [
      {
        // ONE date: this version was published and took effect the same day (an immediate amendment —
        // owner, 2026-10-01; LEGAL_AMENDMENT.immediate), so "published X and in force from X" said it twice.
        en: `This version is in force from ${AMENDED.inForceEn}. Before that date the ${WINDOW_DAYS}-day commitment was described as covering the verified business storefronts whose catalogues appear in product listings and shopping results; it now covers only business sellers that sell through chat on ${SITE_NAME} and have accepted this policy, and linked listings and affiliate shops follow their own shop's policy. A purchase made before ${AMENDED.inForceEn} is governed by the version in force when it was made.`,
        vi: `Phiên bản này có hiệu lực từ ngày ${AMENDED.inForceVi}. Trước ngày đó, cam kết ${WINDOW_DAYS} ngày được mô tả là áp dụng cho các gian hàng doanh nghiệp đã xác minh có danh mục sản phẩm hiển thị trong tin đăng và kết quả mua sắm; nay cam kết chỉ áp dụng cho người bán là doanh nghiệp bán hàng qua kênh nhắn tin trên ${SITE_NAME} và đã chấp nhận chính sách này, còn tin đăng liên kết và cửa hàng liên kết áp dụng chính sách của chính cửa hàng đó. Giao dịch mua trước ngày ${AMENDED.inForceVi} được điều chỉnh bởi phiên bản có hiệu lực tại thời điểm mua.`,
      },
    ],
  },
]

export default async function ReturnsPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params
  const vi = lang === 'vi'
  const intro: Para = {
    en: `Items bought from a business seller that sells through chat on ${SITE_NAME} and has accepted this policy can be returned or exchanged within ${WINDOW_DAYS} days, whether or not there is anything wrong with them. Linked listings follow the source shop's own policy, and listings posted by private individuals are person-to-person sales — this page explains all three.`,
    vi: `Hàng mua từ người bán là doanh nghiệp bán hàng qua kênh nhắn tin trên ${SITE_NAME} và đã chấp nhận chính sách này có thể được trả hoặc đổi trong vòng ${WINDOW_DAYS} ngày, dù hàng có lỗi hay không. Tin đăng liên kết áp dụng chính sách của cửa hàng trên trang nguồn, còn tin do cá nhân đăng là giao dịch giữa cá nhân với nhau — trang này giải thích cả ba trường hợp.`,
  }
  return (
    <ContentPage
      title="Returns and exchanges"
      titleVi="Đổi trả và hoàn tiền"
      meta={
        <>
          <p className="mt-3 text-sm text-ink-4">
            {/* One date: this version was published and took effect the same day
                (LEGAL_AMENDMENT.immediate), and for a returns policy the date that matters to a purchase
                is the one it binds from. The changes section below says what it replaced. */}
            <Bilingual
              en="In force from {date} · Applies to purchases in Vietnam"
              vi="Có hiệu lực từ ngày {date} · Áp dụng cho giao dịch tại Việt Nam"
              values={{ date: vi ? AMENDED.inForceVi : AMENDED.inForceEn }}
            />
          </p>
          <LegalLanguageNote />
        </>
      }
      intro={vi ? intro.vi : <Tr text={intro.en} />}
      sections={sections.map((s) => ({ id: s.id, label: s.title, labelVi: s.titleVi }))}
    >
      {sections.map((s) => (
        <ContentSection key={s.id} id={s.id} title={s.title} titleVi={s.titleVi}>
          <div className="space-y-2">
            {s.paras.map((p, j) => (
              <p key={j} className="text-base leading-relaxed text-body">
                {vi ? linkifyLegal(p.vi) : <LinkifiedTr text={p.en} />}
              </p>
            ))}
            {/* ⚠️ THE DISPUTE CENTER IS A REAL LINK WITH ITS OWN LABEL, NOT A PATH IN A SENTENCE. The
                paragraphs' own paths and mailboxes are linked in place by linkifyLegal (C-LEGAL-UX),
                but this section is the PROCESS a buyer follows when a return goes wrong, and it is
                the part a Merchant Center reviewer checks is actually reachable. One link, appended
                after the paragraphs rather than threaded through them. */}
            {s.id === 'how' ? (
              <p className="text-base leading-relaxed text-body">
                <a href="/disputes" className="font-semibold text-accent-foreground hover:underline">
                  <Tr text="Open a case in the Dispute Center" />
                </a>
              </p>
            ) : null}
          </div>
        </ContentSection>
      ))}
    </ContentPage>
  )
}
