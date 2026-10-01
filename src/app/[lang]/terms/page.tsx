/**
 * ⚠️ KEEP `revalidate` EVEN THOUGH THIS PAGE IS STATIC TODAY.
 *
 * It was added because the page rendered a clock-derived value and, with no revalidate, Next baked
 * that value into on-disk HTML that would have outlived it. That value is gone (there is one Terms
 * version now), so nothing here is time-dependent at this moment — but this is a LEGAL page, and
 * the class of bug is the one src/lib/edition.ts records twice over: /regulations once shipped
 * "PayPal" and "e-Visa" welded into prerendered HTML that no runtime gate could reach. An hour of
 * staleness costs nothing; re-adding this line after someone reintroduces a dynamic value costs a
 * silent wrong page.
 */
export const revalidate = 3600

import { IS_SERVICES, SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import { withShare } from '@/lib/site-identity'
import { Tr } from '@/context/language-context'
import { ContentPage, ContentSection } from '@/components/marketplace/content-page'
import { LinkifiedTr } from '@/components/marketplace/linkified-tr'
import { linkifyLegal } from '@/components/marketplace/legal-linkify'
import { Bilingual } from '@/components/marketplace/bilingual'
import { LegalLanguageNote } from '@/components/legal/legal-language-note'
import { AFFILIATION, COMPANY, OPERATOR_REGISTERED, TOS_PREVIOUS_VERSION, TOS_VERSION, tosVersionInForce } from '@/lib/site-legal'
import { RENTAL_CHECK_MAX_ITEMS } from '@/lib/rental-check/shared'
import { CROSS_SITE_REL, MARKETPLACE_HOME } from '@/lib/cross-site-links'
import { TERMS_SERVICES_COPY } from '@/lib/terms-services-copy'
import { AMENDED } from '@/lib/compliance/legal-amendment'
import { V1, V1_PATHS, archivedPath } from '@/lib/compliance/legal-archive'

// ── Terms of Service — ONE file, rendered by BOTH deployments ───────────────────────────
// eno.vn is a licensed sàn TMĐT classifieds marketplace. eno.forum is the same marketplace plus
// e-visa services SOLD BY a licensed third-party partner, with eno as the intermediary. The legal
// substance that differs between them is not decoration, so it is not written inline here:
//
//   · the words live in `@/lib/terms-services-copy`, which next.config.ts aliases to an inert stub
//     on a marketplace build — that is what keeps the vocabulary out of eno.vn's artifact;
//   · the render is additionally gated on IS_SERVICES — that is what keeps it off the screen.
//
// ⚠️ BOTH, ALWAYS. A gate leaves the strings in the bundle; an alias without a gate would render
// empty headings. See src/lib/edition.ts for the measurement behind that split.
//
// ⚠️ NO COMPANY NAME, LICENCE NUMBER OR REGISTRATION NUMBER IS EVER TYPED INTO THIS FILE. The
// operator comes from COMPANY (src/lib/site-legal.ts) and the e-visa partner from VISA_PROVIDER
// (src/lib/visa-provider.ts). A number typed into a page is a legal defect no lint can see.
//
// ⚠️ SECTION IDS ARE SEMANTIC, NOT POSITIONAL. They were `s0…s9`, which meant `#s7` pointed at a
// different section on each edition (the services build inserts two sections in the middle) and
// would silently re-point again on the next edit. Anchors in these pages get quoted in emails and
// in complaint threads; they have to keep meaning the same thing.
//
// ⚠️ CURATED VIETNAMESE, RENDERED ON THE SERVER (2026-10-01). Law 122/2025 Art 11.2 requires the
// platform's published terms in Vietnamese, and Vietnamese readers used to get the English body under
// a note declaring the ENGLISH authoritative. Each paragraph is now an {en, vi} pair like
// /regulations: the `vi` variant renders the curated text straight into the server HTML; `en` and the
// nine machine-translated languages keep <LinkifiedTr> over the English. Which language governs is
// LegalLanguageNote's job (LEGAL_VI_APPROVED) — never a sentence typed here.
// ⚠️ THE SERVICES-ONLY PARAGRAPHS STAY ENGLISH-ONLY ({ en } with no vi): they come from the aliased
// module above, which deliberately carries no Vietnamese (see its header), so on eno.forum's `vi`
// variant they still go through the translation layer.
//
// ⛔ SHIPS ONLY WITH: W-C (the "Ad" marker + commission note the `linked` and `fees` sections promise,
// and the "Linked shop" chip `trust` names) and the officialPartner DB flip (+ importers that stop
// creating badged storefronts). The TOS_VERSION bump and its in-force instant are in this tree
// (src/lib/site-legal.ts). Version 2 is an IMMEDIATE amendment — in force from its publication day,
// 01/10/2026, with no notice window and no announcement (owner, 2026-10-01; LEGAL_AMENDMENT.immediate) —
// so the "not yet in force" line below never renders for it; it stays for an amendment with a window.

export const metadata: Metadata = withShare({
  title: `Terms of Service | ${SITE_NAME}`,
  description: `The terms that apply when you use ${SITE_NAME}: accounts, listings posted here and listings linked from other sites, our role as an intermediary platform, fees and commissions, liability, complaints and governing law.`,
  alternates: { canonical: '/terms' },
})

/** One paragraph. `vi` absent = English source only (the services-edition copy). */
type Para = { en: string; vi?: string }
type Section = { id: string; title: string; titleVi?: string; paras: Para[] }

const en = (p: string): Para => ({ en: p })

// ⚠️ THE OPERATOR SENTENCE FORKS ON `OPERATOR_REGISTERED`, WHICH IS NOT A FORMALITY. "Operated by X,
// business registration no. Y" is a false statement on an edition whose operator is not incorporated
// (eno.forum today), and the placeholder text ("đang cập nhật" in a field labelled "registration
// no.") does not read as a disclaimer to anyone.
const operatorPara: Para = OPERATOR_REGISTERED
  ? {
      en: `These Terms govern your use of ${SITE_NAME}, an online classifieds marketplace operated by ${COMPANY.name} (${COMPANY.nameEn}), business registration no. ${COMPANY.erc}, issued by ${COMPANY.ercAuthority} on ${COMPANY.ercIssued}, head office ${COMPANY.address}.`,
      vi: `Điều khoản dịch vụ này điều chỉnh việc bạn sử dụng ${SITE_NAME} — chợ rao vặt trực tuyến do ${COMPANY.name} (${COMPANY.nameEn}) vận hành, Giấy chứng nhận đăng ký doanh nghiệp số ${COMPANY.erc} do ${COMPANY.ercAuthority} cấp ngày ${COMPANY.ercIssued}, trụ sở chính tại ${COMPANY.address}.`,
    }
  : {
      en: `These Terms govern your use of ${SITE_NAME}, an online classifieds marketplace for people living in, moving to and visiting Vietnam. They are an agreement between you and the operator of ${SITE_NAME}. The operating company is currently being registered in Vietnam; its registered name, business registration number and head-office address will be published here and in the Operating Regulations as soon as the certificate is issued.`,
      vi: `Điều khoản dịch vụ này điều chỉnh việc bạn sử dụng ${SITE_NAME} — chợ rao vặt trực tuyến dành cho người đang sinh sống, chuẩn bị chuyển đến hoặc đến thăm Việt Nam — và là thoả thuận giữa bạn với đơn vị vận hành ${SITE_NAME}. Công ty vận hành hiện đang làm thủ tục đăng ký thành lập tại Việt Nam; tên đăng ký, số giấy chứng nhận đăng ký doanh nghiệp và địa chỉ trụ sở chính sẽ được công bố tại đây và trong Quy chế hoạt động ngay khi giấy chứng nhận được cấp.`,
    }

const sections: Section[] = [
  {
    id: 'acceptance',
    title: 'Acceptance and what these Terms cover',
    titleVi: 'Chấp nhận Điều khoản và phạm vi áp dụng',
    paras: [
      operatorPara,
      {
        en: `By accessing or using ${SITE_NAME} you agree to these Terms, to the Operating Regulations published at /regulations and to the Privacy Policy published at /privacy, both of which form part of them. If you do not agree, please do not use the service.`,
        vi: `Khi truy cập hoặc sử dụng ${SITE_NAME}, bạn đồng ý với Điều khoản này cùng Quy chế hoạt động công bố tại /regulations và Chính sách bảo vệ dữ liệu cá nhân công bố tại /privacy — hai văn bản này là một phần của Điều khoản. Nếu không đồng ý, vui lòng không sử dụng dịch vụ.`,
      },
      {
        en: `The version of these Terms in force is shown at the top of this page. When you confirm acceptance in the app, that version and the date are recorded against your account, so that either side can tell later which terms applied at the time.`,
        vi: `Phiên bản Điều khoản đang có hiệu lực được ghi ở đầu trang này. Khi bạn xác nhận chấp nhận trong ứng dụng, số phiên bản và ngày chấp nhận được lưu vào tài khoản của bạn, để về sau mỗi bên đều xác định được điều khoản nào đã áp dụng tại thời điểm đó.`,
      },
    ],
  },
  {
    id: 'accounts',
    title: 'Eligibility and accounts',
    titleVi: 'Điều kiện sử dụng và tài khoản',
    paras: [
      {
        en: `You must be at least 18 years old to use ${SITE_NAME}. Keep your sign-in method secure: you are responsible for everything done through your account. Never share a one-time login code with anyone, including someone claiming to work for us — we will never ask you for one.`,
        vi: `Bạn phải đủ 18 tuổi trở lên để sử dụng ${SITE_NAME}. Hãy bảo vệ phương thức đăng nhập của mình: bạn chịu trách nhiệm về mọi hoạt động thực hiện qua tài khoản của bạn. Không bao giờ chia sẻ mã đăng nhập một lần cho bất kỳ ai, kể cả người tự xưng là nhân viên của chúng tôi — chúng tôi không bao giờ hỏi bạn mã này.`,
      },
      {
        en: `Give accurate information when you register and keep it up to date. Do not impersonate another person or business, and do not create an account to get around a suspension.`,
        vi: `Hãy cung cấp thông tin chính xác khi đăng ký và cập nhật khi có thay đổi. Không mạo danh cá nhân hay doanh nghiệp khác, và không tạo tài khoản mới nhằm trốn tránh biện pháp tạm khoá tài khoản.`,
      },
    ],
  },
  {
    // ⚠️ "EVERY LISTING IS POSTED BY ITS SELLER" WAS REMOVED (2026-10-01): most of the shelf is linked
    // listings that eno imported (src/lib/site-facts.ts measures the share), so the sentence was false
    // of most of what a reader sees. The id stays `sellers` — anchors are quoted in complaint threads.
    id: 'sellers',
    title: 'Who posts the listings',
    titleVi: 'Ai đăng tin trên sàn',
    paras: [
      {
        en: `${SITE_NAME} carries two kinds of listing. A listing posted here is created and published by the person or business offering the item or service — not by us. Those sellers write their own descriptions, set their own prices and must hold whatever licences or permits Vietnamese law requires for what they offer, and they are responsible for the accuracy and the legality of everything they post. The other kind, the linked listing, is explained in the next section.`,
        vi: `${SITE_NAME} có hai loại tin đăng. Tin đăng trực tiếp trên sàn do chính cá nhân hoặc doanh nghiệp cung cấp hàng hoá, dịch vụ tạo và đăng — không phải chúng tôi. Người bán tự viết mô tả, tự định giá, phải có đủ giấy phép, giấy chứng nhận mà pháp luật Việt Nam yêu cầu đối với hàng hoá, dịch vụ mình cung cấp, và chịu trách nhiệm về tính chính xác, tính hợp pháp của mọi nội dung mình đăng. Loại thứ hai là tin đăng liên kết, được giải thích ở mục tiếp theo.`,
      },
      {
        en: `We do not own, hold, inspect, store, ship or deliver the items listed, and showing a listing is not an endorsement of its seller or of what is offered.`,
        vi: `Chúng tôi không sở hữu, không nắm giữ, không kiểm định, không lưu kho, không vận chuyển và không giao nhận hàng hoá được rao; việc một tin đăng được hiển thị không có nghĩa là chúng tôi bảo đảm cho người bán hay cho hàng hoá, dịch vụ đó.`,
      },
    ],
  },
  {
    // The canonical linked-listings regime — the same meaning as Quy chế Art 3 (/regulations#activity).
    // Every claim is a code fact: the CTA names the source (affiliate-booking.tsx CtaLabel), the shop
    // row says "not vetted by eno.vn" (pdp-shop-link.tsx), there is no checkout, and the free rental
    // check takes RENTAL_CHECK_MAX_ITEMS (src/lib/rental-check/shared.ts).
    id: 'linked',
    title: 'Linked listings',
    titleVi: 'Tin đăng liên kết',
    paras: [
      {
        en: `Many listings on ${SITE_NAME} are linked listings: copies, for reference, of listings published on another website — a classifieds or property portal, a job board, or a shop's online catalogue (the "source site"). We import them so that you can find them in one place. Every linked listing names its source site, and its button takes you to the source site.`,
        vi: `Nhiều tin trên ${SITE_NAME} là tin đăng liên kết: bản sao để tham khảo của tin đã đăng trên một website khác — trang rao vặt, trang bất động sản, trang tuyển dụng hoặc danh mục sản phẩm trực tuyến của một cửa hàng (gọi chung là "trang nguồn"). Chúng tôi đưa các tin này về để bạn tìm thấy ở cùng một nơi. Mỗi tin đăng liên kết đều ghi rõ trang nguồn, và nút trên tin sẽ đưa bạn sang trang nguồn đó.`,
      },
      {
        en: `For a linked listing we are neither the seller nor the source site. The listing was written and priced by the seller or advertiser on the source site; we have not vetted the item, the seller or the price, and we take no payment for it. You contact the seller, apply or buy on the source site, under that site's own terms, and any deal you make is with the seller there. An item may already be sold or changed on the source site before our copy catches up.`,
        vi: `Đối với tin đăng liên kết, chúng tôi không phải người bán và cũng không phải trang nguồn. Nội dung và giá của tin do người bán hoặc người đăng tin trên trang nguồn đưa ra; chúng tôi chưa thẩm định hàng hoá, người bán hay mức giá, và không nhận bất kỳ khoản thanh toán nào cho tin đó. Bạn liên hệ người bán, ứng tuyển hoặc mua hàng trên trang nguồn theo điều khoản của chính trang đó, và mọi giao dịch của bạn là với người bán tại đó. Hàng hoá có thể đã được bán hoặc thay đổi trên trang nguồn trước khi bản sao của chúng tôi kịp cập nhật.`,
      },
      {
        en: `For a linked rental you can also ask us to check whether it is still available — free, up to ${RENTAL_CHECK_MAX_ITEMS} rentals per request. That help does not make us the landlord, the agent or a party to the rental.`,
        vi: `Với tin cho thuê liên kết, bạn có thể nhờ chúng tôi kiểm tra xem nhà còn trống hay không — miễn phí, tối đa ${RENTAL_CHECK_MAX_ITEMS} tin mỗi lần. Việc hỗ trợ này không khiến chúng tôi trở thành chủ nhà, bên môi giới hay một bên của hợp đồng thuê.`,
      },
      {
        en: `Some linked listings can earn us a commission from the shop or partner when you buy through our link. Such links are labelled as advertising, with a note that we may earn a commission; you do not pay that commission, and it changes neither the price you pay nor the order in which listings are ranked.`,
        vi: `Một số tin đăng liên kết có thể mang lại cho chúng tôi hoa hồng từ cửa hàng hoặc đối tác khi bạn mua qua đường dẫn của chúng tôi. Các đường dẫn này được gắn nhãn quảng cáo kèm ghi chú rằng chúng tôi có thể nhận hoa hồng; bạn không phải trả khoản hoa hồng này, và nó không làm thay đổi giá bạn trả cũng như thứ tự xếp hạng tin đăng.`,
      },
    ],
  },
  {
    id: 'conduct',
    title: 'Posting rules and conduct',
    titleVi: 'Quy tắc đăng tin và ứng xử',
    paras: [
      {
        en: `You are solely responsible for what you post. Provide truthful information and real photographs of the actual item, and honour the prices you advertise. Marketplace prices must be shown in Vietnamese dong (VND), inclusive of tax.`,
        vi: `Bạn hoàn toàn chịu trách nhiệm về nội dung mình đăng. Hãy cung cấp thông tin trung thực, dùng ảnh chụp thật của chính món hàng và bán đúng giá đã đăng. Giá trên sàn phải niêm yết bằng đồng Việt Nam (VND) và đã bao gồm thuế.`,
      },
      {
        en: `You may not post illegal, counterfeit, stolen, unsafe or otherwise prohibited items — the full list is published at /prohibited — and you may not engage in scams, bait pricing, harassment, spam, bulk scraping of other users' contact details, or manipulation of reviews and trust scores. We may remove listings, restrict features, and suspend or close accounts that break these Terms or the law.`,
        vi: `Bạn không được đăng hàng hoá bất hợp pháp, hàng giả, hàng do trộm cắp mà có, hàng không an toàn hoặc hàng bị cấm khác — danh mục đầy đủ công bố tại /prohibited — và không được lừa đảo, dùng giá mồi, quấy rối, gửi tin rác, thu thập hàng loạt thông tin liên hệ của người dùng khác, hay thao túng đánh giá và điểm uy tín. Chúng tôi có thể gỡ tin, hạn chế tính năng, tạm khoá hoặc đóng tài khoản vi phạm Điều khoản này hoặc pháp luật.`,
      },
    ],
  },
  {
    id: 'trust',
    title: 'Trust, verification and moderation',
    titleVi: 'Uy tín, xác minh và kiểm duyệt',
    paras: [
      {
        en: `Listings posted here go live after automated checks, and every seller who posts here carries a trust score earned from verified activity, reviews and confirmed reports. The method is published in full at /trust. A trust score describes a seller who posts here; it says nothing about a linked listing.`,
        vi: `Tin đăng trực tiếp trên sàn chỉ hiển thị sau khi qua các bước kiểm tra tự động, và mỗi người bán đăng tin trên sàn đều có điểm uy tín hình thành từ hoạt động đã được xác minh, đánh giá và các báo cáo đã được xác nhận. Cách tính được công bố đầy đủ tại /trust. Điểm uy tín chỉ phản ánh người bán đăng tin trên sàn, không nói lên điều gì về tin đăng liên kết.`,
      },
      {
        en: `The Official partner badge marks only a company that has signed an agreement with us; a shop whose catalogue we show without such an agreement is labelled a Linked shop. Both are explained on the Official partners page.`,
        vi: `Huy hiệu Đối tác chính thức chỉ dành cho công ty đã ký thoả thuận với chúng tôi; cửa hàng có danh mục sản phẩm được hiển thị trên sàn mà chưa có thoả thuận như vậy được gắn nhãn Cửa hàng liên kết. Cả hai được giải thích tại trang Đối tác chính thức.`,
      },
      {
        en: `Trust badges and scores reduce risk; they are not a guarantee, an endorsement or a warranty, and they do not make us a party to any transaction. Always inspect an item, meet in a safe public place, and treat an unusually good price as a reason for more caution rather than less.`,
        vi: `Huy hiệu và điểm uy tín giúp giảm rủi ro nhưng không phải là sự bảo đảm, sự xác nhận hay cam kết bảo hành, và không khiến chúng tôi trở thành một bên của giao dịch. Hãy luôn kiểm tra hàng, gặp nhau ở nơi công cộng an toàn, và coi một mức giá rẻ bất thường là lý do để thận trọng hơn chứ không phải ít hơn.`,
      },
    ],
  },
  {
    id: 'platform',
    title: `${SITE_NAME} is a platform, not a party to the deal`,
    titleVi: `${SITE_NAME} là nền tảng trung gian, không phải một bên của giao dịch`,
    paras: [
      {
        en: `${SITE_NAME} is an intermediary. We provide a place to publish listings, find them and contact the people behind them. We are not the buyer and not the seller, we take no payment from you for anything listed, we hold no escrow, and we are not responsible for the quality, safety, legality, description, delivery or fitness for purpose of what is listed, or for the conduct of any user.`,
        vi: `${SITE_NAME} là bên trung gian. Chúng tôi cung cấp nơi để đăng tin, tìm tin và liên hệ với người đứng sau tin đăng. Chúng tôi không phải người mua cũng không phải người bán, không thu tiền của bạn cho bất kỳ món hàng nào được rao, không giữ tiền ký quỹ, và không chịu trách nhiệm về chất lượng, độ an toàn, tính hợp pháp, nội dung mô tả, việc giao nhận hay sự phù hợp với mục đích sử dụng của hàng hoá, dịch vụ được rao, cũng như về hành vi của bất kỳ người dùng nào.`,
      },
      {
        en: `Agreements are made between the parties themselves, so your rights over a deal are the rights the law gives you against the other party to it. What we add on top is the report, moderation and complaint process described below and in the Operating Regulations, and we do use it.`,
        vi: `Thoả thuận được xác lập giữa chính các bên, vì vậy quyền của bạn trong một giao dịch là các quyền mà pháp luật trao cho bạn đối với bên kia. Phần chúng tôi bổ sung là quy trình báo cáo, kiểm duyệt và giải quyết khiếu nại mô tả dưới đây và trong Quy chế hoạt động — và chúng tôi thực sự áp dụng quy trình đó.`,
      },
    ],
  },
  // Services edition only — the words come from an aliased module, the render from the gate.
  ...(IS_SERVICES
    ? [
        { id: 'provider', title: TERMS_SERVICES_COPY.providerSection.title, paras: TERMS_SERVICES_COPY.providerSection.paras.map(en) },
        { id: 'documents', title: TERMS_SERVICES_COPY.documentsSection.title, paras: TERMS_SERVICES_COPY.documentsSection.paras.map(en) },
      ]
    : []),
  {
    id: 'fees',
    title: 'Fees',
    titleVi: 'Phí',
    paras: [
      {
        en: `Creating an account, browsing, posting and contacting sellers are currently free — you pay us nothing. We process no payments between buyers and sellers and we hold no money at any point.`,
        vi: `Việc tạo tài khoản, xem tin, đăng tin và liên hệ người bán hiện đều miễn phí — bạn không phải trả cho chúng tôi bất kỳ khoản nào. Chúng tôi không xử lý thanh toán giữa người mua và người bán và không giữ tiền của ai vào bất kỳ thời điểm nào.`,
      },
      {
        en: `We may earn a commission from some partners and affiliate shops when you buy through a link on ${SITE_NAME}. You do not pay it, it does not change the price you pay, and every link that can earn it is labelled.`,
        vi: `Chúng tôi có thể nhận hoa hồng từ một số đối tác và cửa hàng liên kết khi bạn mua hàng qua đường dẫn trên ${SITE_NAME}. Bạn không phải trả khoản này, nó không làm thay đổi giá bạn phải trả, và mọi đường dẫn có thể mang lại hoa hồng đều được gắn nhãn.`,
      },
      {
        // 20 days, not 5: Decree 248/2026 Art 8.2 sets 20 days for changes to seller fees (worded for
        // platforms with online ordering; adopted here as the stricter commitment).
        en: `If paid features for sellers are introduced — a subscription, a promoted listing — their prices will be published in VND at least 20 days before they apply, and paid placement will always be visibly labelled as such.`,
        vi: `Nếu sau này có tính năng thu phí dành cho người bán — như gói thuê bao hay tin được ưu tiên hiển thị — mức phí sẽ được công bố bằng đồng Việt Nam ít nhất 20 ngày trước ngày áp dụng, và mọi vị trí hiển thị có trả phí luôn được gắn nhãn rõ ràng.`,
      },
      ...(IS_SERVICES ? TERMS_SERVICES_COPY.feesParas.map(en) : []),
    ],
  },
  {
    id: 'content',
    title: 'Your content',
    titleVi: 'Nội dung của bạn',
    paras: [
      {
        en: `You keep ownership of what you post. By posting it you grant us a non-exclusive, worldwide, royalty-free licence to host, store, reproduce, translate, resize and display that content for the purpose of operating, improving and promoting the service.`,
        vi: `Bạn vẫn là chủ sở hữu nội dung mình đăng. Khi đăng, bạn cấp cho chúng tôi quyền sử dụng không độc quyền, trên phạm vi toàn cầu và không thu phí bản quyền để lưu trữ, sao chép, dịch, thay đổi kích thước và hiển thị nội dung đó nhằm vận hành, cải thiện và quảng bá dịch vụ.`,
      },
      {
        en: `You confirm that you have the right to post what you upload and that it does not infringe anyone else's rights. The licence ends when you delete the content, except for copies the law requires us to keep and copies in backups that are queued for deletion in the ordinary course.`,
        vi: `Bạn xác nhận mình có quyền đăng những gì đã tải lên và nội dung đó không xâm phạm quyền của người khác. Quyền sử dụng nói trên chấm dứt khi bạn xoá nội dung, trừ các bản sao mà pháp luật buộc chúng tôi lưu giữ và các bản sao lưu đang chờ xoá theo quy trình thông thường.`,
      },
    ],
  },
  {
    id: 'liability',
    title: 'Disclaimers and limitation of liability',
    titleVi: 'Miễn trừ và giới hạn trách nhiệm',
    paras: [
      {
        en: `${SITE_NAME} is provided "as is" and "as available", without warranties of any kind so far as the law allows. We do not promise that the service will be uninterrupted or error-free, and we do not verify or endorse user-posted content.`,
        vi: `${SITE_NAME} được cung cấp theo hiện trạng và theo khả năng sẵn có, không kèm bất kỳ bảo đảm nào trong phạm vi pháp luật cho phép. Chúng tôi không cam kết dịch vụ luôn liên tục hay không có lỗi, và không kiểm chứng hay bảo đảm cho nội dung do người dùng đăng.`,
      },
      {
        en: `Because we act as an intermediary, we are not liable for loss arising out of a transaction, agreement or dealing between you and another user or a third party you found through the service. To the maximum extent Vietnamese law permits, we are not liable for indirect, incidental, special or consequential loss, or for lost profit, revenue, data or goodwill; and our total liability for any claim connected with the service is limited to the amount, if any, you paid us in the twelve months before the claim arose.`,
        vi: `Vì là bên trung gian, chúng tôi không chịu trách nhiệm về tổn thất phát sinh từ giao dịch, thoả thuận hay quan hệ giữa bạn với người dùng khác hoặc với bên thứ ba mà bạn tìm thấy qua dịch vụ. Trong phạm vi tối đa pháp luật Việt Nam cho phép, chúng tôi không chịu trách nhiệm về thiệt hại gián tiếp, ngẫu nhiên, đặc biệt hay thiệt hại phát sinh theo hệ quả, hoặc về việc mất lợi nhuận, doanh thu, dữ liệu hay uy tín; tổng trách nhiệm của chúng tôi đối với mọi khiếu nại liên quan đến dịch vụ được giới hạn ở số tiền (nếu có) bạn đã trả cho chúng tôi trong mười hai tháng trước khi phát sinh khiếu nại.`,
      },
      ...(IS_SERVICES ? TERMS_SERVICES_COPY.liabilityParas.map(en) : []),
      {
        en: `Nothing in these Terms excludes or limits any liability that Vietnamese law does not allow to be excluded — including your rights under the Law on Protection of Consumer Rights, liability for death or personal injury caused by our negligence, and liability for fraud.`,
        vi: `Không điều nào trong Điều khoản này loại trừ hay hạn chế trách nhiệm mà pháp luật Việt Nam không cho phép loại trừ — bao gồm các quyền của bạn theo Luật Bảo vệ quyền lợi người tiêu dùng, trách nhiệm đối với thiệt hại về tính mạng, sức khoẻ do lỗi của chúng tôi gây ra, và trách nhiệm đối với hành vi gian lận.`,
      },
    ],
  },
  {
    id: 'complaints',
    title: 'Complaints and reports',
    titleVi: 'Khiếu nại và báo cáo',
    paras: [
      {
        en: `Report a listing, a seller or a conversation with the Report control on the item itself, or write to ${COMPANY.email}. Reports are acknowledged within 3 working days and handled through the process set out in Article 12 of the Operating Regulations, which also lists the deadline for each kind of issue.`,
        vi: `Bạn có thể báo cáo tin đăng, người bán hoặc cuộc trò chuyện bằng nút Báo cáo ngay trên đó, hoặc gửi email tới ${COMPANY.email}. Báo cáo được xác nhận đã tiếp nhận trong vòng 3 ngày làm việc và được xử lý theo quy trình tại Điều 12 Quy chế hoạt động, nơi nêu rõ thời hạn cho từng loại việc.`,
      },
      {
        en: `Complaints about the platform — your account, a moderation decision, the site itself — come to us. A complaint about another user is in the first instance between you and that user: we forward it, we give the parties and the competent authorities the record where the law allows, and we apply our own enforcement where our rules were broken.`,
        vi: `Khiếu nại về nền tảng — tài khoản của bạn, một quyết định kiểm duyệt hay chính website — xin gửi cho chúng tôi. Khiếu nại về một người dùng khác trước hết là việc giữa bạn và người đó: chúng tôi chuyển khiếu nại, cung cấp hồ sơ cho các bên và cơ quan có thẩm quyền trong phạm vi pháp luật cho phép, và áp dụng biện pháp xử lý của mình khi quy định của sàn bị vi phạm.`,
      },
      {
        en: `A complaint about the item, the price or the seller of a linked listing belongs with the source site and its seller. Tell us as well if a linked listing breaks our rules or the law, and we will take our copy down.`,
        vi: `Khiếu nại về hàng hoá, giá hay người bán của một tin đăng liên kết thuộc về trang nguồn và người bán tại đó. Bạn cũng nên báo cho chúng tôi nếu tin đăng liên kết vi phạm quy định của sàn hoặc pháp luật — chúng tôi sẽ gỡ bản sao trên sàn.`,
      },
      ...(IS_SERVICES ? TERMS_SERVICES_COPY.complaintParas.map(en) : []),
    ],
  },
  {
    id: 'termination',
    title: 'Suspension and termination',
    titleVi: 'Tạm khoá và chấm dứt',
    paras: [
      {
        en: `We may suspend or terminate access where these Terms or the law are broken, or where it is necessary to protect users or the service. Where it is reasonable to do so we will tell you why and, for anything short of a serious breach, give you a chance to put it right.`,
        vi: `Chúng tôi có thể tạm khoá hoặc chấm dứt quyền truy cập khi Điều khoản này hoặc pháp luật bị vi phạm, hoặc khi cần thiết để bảo vệ người dùng hay dịch vụ. Khi phù hợp, chúng tôi sẽ cho bạn biết lý do và, trừ trường hợp vi phạm nghiêm trọng, cho bạn cơ hội khắc phục.`,
      },
      {
        en: `You may stop using ${SITE_NAME} at any time and ask for your account to be deleted, from your account settings or by writing to ${COMPANY.email}. Deletion is handled as described in the Privacy Policy.`,
        vi: `Bạn có thể ngừng sử dụng ${SITE_NAME} bất cứ lúc nào và yêu cầu xoá tài khoản, trong phần cài đặt tài khoản hoặc bằng cách gửi email tới ${COMPANY.email}. Việc xoá tài khoản được thực hiện như mô tả trong Chính sách bảo vệ dữ liệu cá nhân.`,
      },
    ],
  },
  {
    id: 'law',
    title: 'Governing law and disputes',
    titleVi: 'Luật áp dụng và giải quyết tranh chấp',
    paras: [
      {
        en: `These Terms and your use of ${SITE_NAME} are governed by the law of Vietnam. A dispute between you and us that cannot be settled amicably goes to the competent court in Ho Chi Minh City, Vietnam. Consumers keep every protection Vietnamese consumer-protection law gives them, including the right to complain to consumer-protection authorities and organizations, and nothing here takes that away.`,
        vi: `Điều khoản này và việc bạn sử dụng ${SITE_NAME} chịu sự điều chỉnh của pháp luật Việt Nam. Tranh chấp giữa bạn và chúng tôi không giải quyết được bằng thương lượng sẽ được đưa ra Toà án có thẩm quyền tại Thành phố Hồ Chí Minh, Việt Nam. Người tiêu dùng được giữ nguyên mọi sự bảo vệ mà pháp luật về bảo vệ quyền lợi người tiêu dùng của Việt Nam dành cho họ, bao gồm quyền khiếu nại tới cơ quan, tổ chức bảo vệ quyền lợi người tiêu dùng; không điều khoản nào ở đây làm mất các quyền đó.`,
      },
      {
        en: `Disputes between users are between those users. The complaint process described above and in the Operating Regulations sets out how we assist.`,
        vi: `Tranh chấp giữa người dùng với nhau là việc của chính các bên đó. Quy trình khiếu nại nêu trên và trong Quy chế hoạt động mô tả cách chúng tôi hỗ trợ.`,
      },
    ],
  },
  {
    id: 'related',
    title: 'Related sites',
    titleVi: 'Các website liên quan',
    paras: [{ en: AFFILIATION.en, vi: AFFILIATION.vi }],
  },
  {
    id: 'changes',
    title: 'Changes to these Terms, and contact',
    titleVi: 'Sửa đổi Điều khoản và liên hệ',
    paras: [
      {
        // ⚠️ "THE VERSION SHOWN … CHANGES WITH THEM" IS THE PRE-EXISTING PROMISE, KEPT WORD FOR WORD: rewording it
        // to "the date" was a substantive edit missing from the change note. It binds a TOS_VERSION bump.
        en: `We may update these Terms as the law or the product changes. Material changes are announced on the platform at least 5 days before they take effect, and the version shown at the top of this page changes with them. Continuing to use the service after the effective date means you accept the new version; if you do not, please stop using it, and you may ask for your account to be deleted.`,
        vi: `Chúng tôi có thể cập nhật Điều khoản này khi pháp luật hoặc sản phẩm thay đổi. Những thay đổi quan trọng được thông báo trên nền tảng ít nhất 5 ngày trước ngày có hiệu lực, và số phiên bản ghi ở đầu trang thay đổi theo. Việc tiếp tục sử dụng dịch vụ sau ngày có hiệu lực đồng nghĩa với việc bạn chấp nhận nội dung mới; nếu không đồng ý, vui lòng ngừng sử dụng và bạn có thể yêu cầu xoá tài khoản.`,
      },
      {
        // ⚠️ A DATED CHANGE NOTE, NOT A CLOCK: the date is typed once in LEGAL_AMENDMENT
        // (src/lib/compliance/legal-amendment.ts), so nothing here goes stale in HTML. ONE date: version 2
        // was published and took effect the same day (immediate — owner, 2026-10-01), so "published X,
        // in force X" would only say it twice.
        // ⚠️ THE PREVIOUS WORDING IS LINKED, NOT "WRITE TO US FOR A COPY" (2026-10-01 review): everyone who
        // accepted before 01/10 — and on 01/10 before this deploy — is stamped version 1, so it stays
        // published at /terms/v1 (src/lib/compliance/legal-archive.ts), permanently.
        en: `Changes in force from ${AMENDED.inForceEn}: the section on who posts listings rewritten to tell the two kinds apart, and a new section on linked listings, including where complaints about them go; automated checks before publication and trust scores described as applying to listings posted here; the Official partner badge reserved for companies with a signed agreement, other shops being labelled Linked shop; disclosure that we may earn a commission on some partner and affiliate links; fee changes announced at least 20 days ahead instead of 5; and a Vietnamese text of these Terms. The previous wording (version ${V1}) is published at ${V1_PATHS.terms}.`,
        vi: `Các thay đổi có hiệu lực từ ngày ${AMENDED.inForceVi}: viết lại mục Ai đăng tin trên sàn để phân biệt hai loại tin đăng, và bổ sung mục Tin đăng liên kết, kể cả nơi tiếp nhận khiếu nại về loại tin này; nêu rõ việc kiểm tra tự động trước khi hiển thị và điểm uy tín chỉ áp dụng cho tin đăng trực tiếp trên sàn; huy hiệu Đối tác chính thức chỉ dành cho công ty đã ký thoả thuận, các cửa hàng khác được gắn nhãn Cửa hàng liên kết; công khai việc chúng tôi có thể nhận hoa hồng từ một số đường dẫn của đối tác và cửa hàng liên kết; mọi thay đổi về phí được công bố trước ít nhất 20 ngày, thay vì 5 ngày như trước đây; và bổ sung bản tiếng Việt của Điều khoản. Nội dung trước sửa đổi (phiên bản ${V1}) được lưu tại ${V1_PATHS.terms}.`,
      },
      {
        en: `Questions about these Terms: ${COMPANY.email}.`,
        vi: `Mọi câu hỏi về Điều khoản này xin gửi tới ${COMPANY.email}.`,
      },
    ],
  },
  // A stub-fed section is empty on the marketplace edition. The gates above already prevent that,
  // and this is the belt to their braces: a future call site that forgets one renders nothing
  // rather than an untitled heading.
].filter((s) => s.title && s.paras.length > 0)

export default async function TermsPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params
  const vi = lang === 'vi'
  // ⚠️ READ AT RENDER, AND THIS PAGE IS ISR (revalidate above): the headline can lag the in-force
  // instant by up to one revalidation. It lags toward the OLD version — toward more notice — which is
  // the direction that is safe to be late in; the site-wide notice (tos-change-notice.tsx, mounted only
  // while an amendment has a window) is client-side and exact.
  const inForce = tosVersionInForce()
  return (
    <ContentPage
      title="Terms of Service"
      titleVi="Điều khoản dịch vụ"
      meta={
        <>
          <p className="mt-3 text-sm text-ink-4">
            {/* ⚠️ THE VERSION IN FORCE IS THE HEADLINE, NOT THE NEWEST ONE — the `acceptance` section
                promises "the version of these Terms in force is shown at the top of this page", and
                during a notice window the two differ (tosVersionInForce, src/lib/site-legal.ts). The
                dated change note lives in the `changes` section. */}
            <Bilingual en="Last updated: {date}" vi="Cập nhật lần cuối: {date}" values={{ date: vi ? AMENDED.publishedVi : AMENDED.publishedEn }} /> · <Tr text="Version" /> {inForce}
          </p>
          {inForce !== TOS_VERSION ? (
            // Says which text binds TODAY: the body below is the newer version, published but not yet
            // in force. Without this line "published" reads as "in force".
            // The version in force is one tap away, not "write to us" (legal-archive.ts).
            <p className="mt-1 max-w-[70ch] text-sm text-ink-4">
              <Bilingual
                en="The text below is version {next}, published on {published} and in force from {inForce}. Until then, version {prev} remains in force."
                vi="Nội dung dưới đây là phiên bản {next}, công bố ngày {published} và có hiệu lực từ ngày {inForce}. Trước ngày đó, phiên bản {prev} vẫn là phiên bản đang có hiệu lực."
                values={{
                  next: TOS_VERSION,
                  prev: TOS_PREVIOUS_VERSION,
                  published: vi ? AMENDED.publishedVi : AMENDED.publishedEn,
                  inForce: vi ? AMENDED.inForceVi : AMENDED.inForceEn,
                }}
              />{' '}
              <a href={archivedPath('terms', TOS_PREVIOUS_VERSION)} className="font-semibold text-accent-foreground hover:underline">
                <Bilingual en="Read version {prev}" vi="Xem phiên bản {prev}" values={{ prev: TOS_PREVIOUS_VERSION }} />
              </a>
            </p>
          ) : null}
          <LegalLanguageNote />
        </>
      }
      sections={sections.map((s) => ({ id: s.id, label: s.title, labelVi: s.titleVi }))}
    >
      {sections.map((s) => (
        <ContentSection key={s.id} id={s.id} title={s.title} titleVi={s.titleVi}>
          <div className="space-y-2">
            {s.paras.map((p, j) => (
              <p key={j} className="text-base leading-relaxed text-body">
                {vi && p.vi ? linkifyLegal(p.vi) : <LinkifiedTr text={p.en} />}
              </p>
            ))}
            {s.id === 'related' && IS_SERVICES && MARKETPLACE_HOME ? (
              <p className="text-base leading-relaxed text-body">
                <Tr text="The classifieds side of the brand has its own site, with its own operator details, terms and privacy policy:" />{' '}
                <a href={MARKETPLACE_HOME.href} rel={CROSS_SITE_REL} className="font-semibold text-accent-foreground hover:underline">
                  <Tr text={MARKETPLACE_HOME.labelEn} />
                </a>
              </p>
            ) : null}
          </div>
        </ContentSection>
      ))}
    </ContentPage>
  )
}
