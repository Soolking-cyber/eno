/**
 * ⚠️ NOT FULLY STATIC — see the long note in src/app/terms/page.tsx.
 *
 * This page renders TOS_VERSION and promises, in Vietnamese, that amendments are announced at least
 * 5 days before taking effect. A build-time-frozen copy of that promise is the one thing worse than
 * not making it. It is also the page src/lib/edition.ts cites as having baked "PayPal" and "e-Visa"
 * into on-disk HTML that no runtime gate could reach.
 */
export const revalidate = 3600

import type { Metadata } from 'next'
import { IS_SERVICES, SITE_NAME } from '@/lib/edition'
import { ContentPage, ContentSection } from '@/components/marketplace/content-page'
import { AFFILIATION, COMPANY, OPERATOR_REGISTERED, TOS_VERSION } from '@/lib/site-legal'
import { PROVIDER_OF_RECORD } from '@/lib/visa-provider'

/**
 * QUY CHẾ HOẠT ĐỘNG — the operating regulations of the sàn giao dịch thương mại điện tử.
 *
 * This is the document MoIT reads at platform registration (online.gov.vn), so it is written to be
 * COMPLETE against Nghị định 52/2013/NĐ-CP Đ.38.2 as amended by 85/2021/NĐ-CP: the nine mandatory
 * contents plus the two later additions (public disclosure of the display/ranking criteria, and the
 * 5-day advance notice for amendments in Đ.38.3).
 *
 * ⚠️ VIETNAMESE IS THE AUTHORITATIVE TEXT AND IS RENDERED UNCONDITIONALLY. Both languages are part
 * of the published document, not alternatives to each other — the filed version is the Vietnamese
 * one, and a reviewer who lands here with an English UI preference must still see it. That is why
 * the body copy below is a pair of fixed literals per paragraph rather than `<Tr text="…">`:
 *
 *   · `<Tr>` renders ONE language at a time. On an English session the Vietnamese would not be on
 *     the page at all, which is the one thing this document cannot afford.
 *   · For `vi` it would fall back to MACHINE TRANSLATION of the English source (there is no curated
 *     entry in vi-overrides for any of this), i.e. the legally operative text of a filed instrument
 *     would be generated at runtime by an MT provider. src/lib/site-legal.ts and
 *     src/lib/visa-provider.ts both say the same thing about their own constants: render the curated
 *     pair, do not send legal copy through the translation layer.
 *
 * The `<Tr>` mechanism still governs this page's CHROME — ContentPage translates the eyebrow, the
 * h1 and the left-rail labels — so the i18n contract is intact where it applies. The eslint i18n
 * gate (react/jsx-no-literals) is satisfied because no copy is typed into JSX: every string is a
 * field on ARTICLES below and reaches the markup as an expression.
 *
 * ⚠️ THIS PAGE RENDERS ON BOTH EDITIONS AND MUST STAY CORRECT ON BOTH (see src/lib/edition.ts).
 * eno.vn is the licensed marketplace and may not so much as mention the e-visa service, so:
 *   · every self-reference uses SITE_NAME, never a hardcoded "eno.vn" — otherwise eno.forum
 *     publishes an operating regulation naming the licensed company as its operator;
 *   · the only services-specific copy is PROVIDER_OF_RECORD, gated on IS_SERVICES *and* imported
 *     from a module next.config.ts aliases to a stub on a marketplace build. The gate stops the
 *     render; only the alias keeps the partner's name out of eno.vn's artifact.
 *
 * ⚠️ WHAT WAS DELIBERATELY REMOVED, 2026-08: the old §7 named PayPal/Stripe and described an
 * "assisted e-Visa application service" sold by eno itself. A licensed marketplace's own compliance
 * text must not describe a payment function it does not have, and eno does not sell visa services at
 * all — a licensed third party does, with the platform as intermediary. Do not reintroduce either.
 *
 * ⚠️ NO COMPANY NAME, ERC OR LICENCE NUMBER IS TYPED HERE. They come from COMPANY (site-legal.ts)
 * and VISA_PROVIDER (visa-provider.ts), both of which are placeholders until the documents exist.
 * OPERATOR_REGISTERED gates the paragraph that says so out loud, because a field reading
 * "đang cập nhật" does not tell a reader that no company has been incorporated yet.
 */

const S = SITE_NAME

type Para = { vi: string; en: string }
type Article = {
  id: string
  /** Left-rail label. English on purpose: it is navigation chrome and goes through <Tr>. */
  rail: string
  titleVi: string
  titleEn: string
  body: Para[]
  links?: { href: string; label: string }[]
}

const INTRO: Para = {
  vi: `Quy chế này mô tả cách sàn giao dịch thương mại điện tử ${S} được tổ chức và vận hành: phạm vi hoạt động, quyền và nghĩa vụ của đơn vị vận hành, của người bán và của người mua, quy trình đăng tin và giao dịch, cách rà soát và xử lý vi phạm, cách tiếp nhận khiếu nại và tranh chấp, cách bảo vệ dữ liệu cá nhân, và tiêu chí sắp xếp hiển thị tin đăng. Đây là văn bản bắt buộc công bố theo Nghị định 52/2013/NĐ-CP (sửa đổi, bổ sung bởi Nghị định 85/2021/NĐ-CP) và là một phần của thoả thuận giữa ${S} và người sử dụng.`,
  en: `These Regulations describe how the ${S} e-commerce trading platform is organised and operated: the scope of its activity, the rights and duties of the operator, of sellers and of buyers, the listing and transaction process, how content is reviewed and breaches are dealt with, how complaints and disputes are handled, how personal data is protected, and the criteria by which listings are sorted and displayed. Publishing this document is mandatory under Decree 52/2013/ND-CP (as amended by Decree 85/2021/ND-CP), and it forms part of the agreement between ${S} and its users.`,
}

const META: Para = {
  vi: `Phiên bản ${TOS_VERSION}. Bản tiếng Việt là bản có giá trị pháp lý; bản tiếng Anh là bản dịch tham khảo. Mọi sửa đổi được công bố trên sàn ít nhất 5 ngày trước ngày có hiệu lực.`,
  en: `Version ${TOS_VERSION}. The Vietnamese text is the authoritative one; the English is a translation provided for convenience. Any amendment is announced on the platform at least 5 days before it takes effect.`,
}

const ARTICLES: Article[] = [
  {
    id: 'scope',
    rail: '1. Scope & general principles',
    titleVi: 'Điều 1. Phạm vi điều chỉnh và nguyên tắc chung',
    titleEn: 'Article 1. Scope and general principles',
    body: [
      {
        vi: `Quy chế này điều chỉnh việc tổ chức và vận hành website ${S} — một sàn giao dịch thương mại điện tử theo pháp luật Việt Nam — và áp dụng cho toàn bộ thành viên đã đăng ký, người bán, người mua và khách truy cập. Quy chế được xây dựng trên cơ sở Nghị định 52/2013/NĐ-CP (sửa đổi, bổ sung bởi Nghị định 85/2021/NĐ-CP), Luật Thương mại điện tử 122/2025/QH15, Luật Bảo vệ quyền lợi người tiêu dùng 19/2023/QH15 và Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15.`,
        en: `These Regulations govern the organisation and operation of ${S}, an e-commerce trading platform under Vietnamese law, and apply to every registered member, seller, buyer and visitor. They are issued under Decree 52/2013/ND-CP (as amended by Decree 85/2021/ND-CP), the Law on E-commerce 122/2025/QH15, the Law on Protection of Consumer Rights 19/2023/QH15 and the Law on Personal Data Protection 91/2025/QH15.`,
      },
      {
        vi: `${S} là sàn trung gian. Người bán tự đăng tin và tự chịu trách nhiệm về tin đăng của mình; người mua và người bán liên hệ, thương lượng và hoàn tất giao dịch trực tiếp với nhau. Đơn vị vận hành sàn không phải là một bên của bất kỳ giao dịch nào giữa người mua và người bán.`,
        en: `${S} is an intermediary platform. Sellers post their own listings and are responsible for them; buyers and sellers contact each other, negotiate and complete the transaction directly. The platform operator is not a party to any transaction between a buyer and a seller.`,
      },
      {
        vi: `Người sử dụng phải từ đủ 18 tuổi trở lên, cung cấp thông tin trung thực và tuân thủ pháp luật Việt Nam cùng Quy chế này. Việc đăng ký tài khoản hoặc tiếp tục sử dụng ${S} được hiểu là người sử dụng đã đọc, hiểu và chấp nhận Quy chế.`,
        en: `Users must be at least 18 years old, give truthful information, and comply with Vietnamese law and these Regulations. Registering an account or continuing to use ${S} means the user has read, understood and accepted them.`,
      },
    ],
  },
  {
    id: 'operator',
    rail: '2. Platform operator',
    titleVi: 'Điều 2. Đơn vị vận hành sàn',
    titleEn: 'Article 2. The platform operator',
    body: [
      {
        vi: `Đơn vị vận hành: ${COMPANY.name}. Trụ sở: ${COMPANY.address}. Giấy chứng nhận đăng ký doanh nghiệp số: ${COMPANY.erc} (cấp ngày ${COMPANY.ercIssued}). Điện thoại: ${COMPANY.phone}. Email: ${COMPANY.email}.`,
        en: `Operator: ${COMPANY.nameEn}. Head office: ${COMPANY.address}. Enterprise registration certificate no.: ${COMPANY.erc} (issued ${COMPANY.ercIssued}). Phone: ${COMPANY.phone}. Email: ${COMPANY.email}.`,
      },
      // The placeholder fields above read as blanks, not as a statement that no company exists yet.
      // This paragraph says it in words, and disappears on its own the day the ERC is issued.
      ...(OPERATOR_REGISTERED
        ? []
        : [
            {
              vi: `Tại thời điểm công bố Quy chế này, pháp nhân vận hành sàn đang trong quá trình đăng ký thành lập và sàn đang ở giai đoạn vận hành thử nghiệm trước khi ra mắt chính thức. Các trường thông tin đăng ký chưa được điền ở trên sẽ được cập nhật đầy đủ ngay khi giấy chứng nhận đăng ký doanh nghiệp được cấp, và sàn chỉ hoạt động chính thức sau khi hoàn tất thủ tục đăng ký với Bộ Công Thương. Trong giai đoạn này, mọi liên hệ xin gửi về ${COMPANY.email}.`,
              en: `At the time these Regulations are published, the operating entity is still being registered and the platform is in pre-launch test operation. The registration fields left blank above will be completed as soon as the enterprise registration certificate is issued, and the platform will operate officially only once its registration with the Ministry of Industry and Trade is complete. Until then, please use ${COMPANY.email} for all contact.`,
            },
          ]),
      {
        vi: `Địa chỉ liên hệ trên đây đồng thời là đầu mối tiếp nhận yêu cầu của người sử dụng và của cơ quan nhà nước có thẩm quyền (quản lý thị trường, thuế, công an). Yêu cầu gỡ bỏ nội dung vi phạm của cơ quan nhà nước có thẩm quyền được thực hiện trong vòng 24 giờ kể từ khi nhận được yêu cầu.`,
        en: `The contact details above are also the designated point of contact for users and for competent state authorities (market surveillance, tax, public security). A lawful request from a competent authority to remove infringing content is actioned within 24 hours of receipt.`,
      },
      { vi: AFFILIATION.vi, en: AFFILIATION.en },
    ],
  },
  {
    id: 'activity',
    rail: '3. What the platform does',
    titleVi: 'Điều 3. Phạm vi hoạt động của sàn',
    titleEn: 'Article 3. Scope of the platform’s activity',
    body: [
      {
        vi: `${S} cung cấp môi trường để tổ chức, cá nhân đăng tin rao bán hoặc cho thuê hàng hoá, dịch vụ, và để người mua tìm kiếm tin đăng rồi liên hệ trực tiếp với người bán qua kênh nhắn tin trên sàn. Các nhóm ngành hàng chính gồm nhà ở, việc làm, xe cộ, đồ đã qua sử dụng và dịch vụ dành cho người nước ngoài đang sinh sống tại Việt Nam.`,
        en: `${S} provides an environment where organisations and individuals post listings offering goods and services for sale or rent, and where buyers search those listings and contact sellers directly through the platform’s messaging. The main categories are housing, jobs, vehicles, secondhand goods and services for foreigners living in Vietnam.`,
      },
      {
        vi: `Sàn KHÔNG có chức năng đặt hàng trực tuyến và KHÔNG có chức năng thanh toán trực tuyến giữa người mua và người bán. Sàn không giữ tiền ký quỹ (tạm giữ) của bất kỳ bên nào, không nhận đặt cọc thay người bán, không vận chuyển và không giao nhận hàng hoá. Giá hiển thị trên tin đăng là giá chào bán do người bán tự công bố; việc chốt giá, thanh toán và bàn giao do hai bên tự thoả thuận và tự thực hiện ngoài sàn.`,
        en: `The platform has NO online ordering function and NO online payment function between buyer and seller. It holds no escrow for anyone, takes no deposit on a seller’s behalf, and does not ship or deliver goods. A listed price is the seller’s own published asking price; agreeing the price, paying and handing over are arranged and carried out by the two parties themselves, off the platform.`,
      },
      {
        vi: `Kênh nhắn tin giữa người mua và người bán là kênh trao đổi riêng tư 1:1 về một tin đăng cụ thể, không phải kênh đăng tải nội dung ra công chúng.`,
        en: `Messaging between a buyer and a seller is a private one-to-one channel about a specific listing, not a channel for posting content to the public.`,
      },
    ],
  },
  {
    id: 'operator-duties',
    rail: '4. Operator’s rights & duties',
    titleVi: 'Điều 4. Quyền và nghĩa vụ của đơn vị vận hành sàn',
    titleEn: 'Article 4. Rights and duties of the platform operator',
    body: [
      {
        vi: `Đơn vị vận hành có nghĩa vụ: xây dựng và công bố công khai Quy chế này; đăng ký, thông báo website với Bộ Công Thương theo quy định; bảo đảm sàn vận hành ổn định và an toàn; yêu cầu, tiếp nhận và lưu giữ thông tin của người bán theo quy định; rà soát tin đăng và loại bỏ nội dung vi phạm; công bố công khai tiêu chí sắp xếp và hiển thị tin đăng; tiếp nhận, xử lý và phản hồi khiếu nại theo thời hạn đã công bố; bảo vệ dữ liệu cá nhân của người sử dụng; lưu trữ hồ sơ, chứng từ liên quan đến hoạt động của sàn theo thời hạn pháp luật yêu cầu (tối thiểu 3 năm); và cung cấp thông tin, phối hợp với cơ quan nhà nước có thẩm quyền khi được yêu cầu, bao gồm việc báo cáo thông tin người bán cho cơ quan thuế theo quy định.`,
        en: `The operator must: draw up and publish these Regulations; register or notify the website with the Ministry of Industry and Trade as required; keep the platform running stably and securely; require, receive and retain seller information as required; review listings and remove infringing content; publish the criteria by which listings are sorted and displayed; receive, handle and answer complaints within the published deadlines; protect users’ personal data; retain records relating to the platform’s operation for the period the law requires (at least 3 years); and provide information to and cooperate with competent state authorities on request, including reporting seller information to the tax authority as required.`,
      },
      {
        vi: `Đơn vị vận hành có quyền: yêu cầu người bán bổ sung và chứng minh thông tin, giấy tờ theo quy định; từ chối đăng, tạm ẩn hoặc gỡ bỏ tin đăng vi phạm pháp luật hoặc Quy chế này; cảnh báo, hạn chế tính năng, tạm khoá hoặc chấm dứt tài khoản vi phạm; điều chỉnh danh mục, tính năng và tiêu chí hiển thị của sàn; và ban hành các chính sách chi tiết hoá Quy chế này, với điều kiện các chính sách đó không trái Quy chế và được công bố công khai.`,
        en: `The operator may: require sellers to supply and evidence information and documents; refuse, hide or remove a listing that breaches the law or these Regulations; warn, restrict, suspend or terminate an account in breach; change the platform’s categories, features and display criteria; and issue further policies implementing these Regulations, provided they do not conflict with them and are published.`,
      },
    ],
  },
  {
    id: 'sellers',
    rail: '5. Sellers’ rights & duties',
    titleVi: 'Điều 5. Quyền và nghĩa vụ của người bán',
    titleEn: 'Article 5. Rights and duties of sellers',
    body: [
      {
        vi: `Người bán được đăng tin, quản lý gian hàng, nhận liên hệ từ người mua, thương lượng giá và được khiếu nại đối với biện pháp xử lý áp dụng cho mình theo Điều 12.`,
        en: `Sellers may post listings, manage their storefront, receive enquiries from buyers, negotiate on price, and appeal any enforcement measure applied to them under Article 12.`,
      },
      {
        vi: `Người bán đăng ký tài khoản bằng số điện thoại hoặc email đã xác minh và phải cung cấp thông tin đầy đủ, chính xác theo quy định: họ tên hoặc tên tổ chức, địa chỉ, số căn cước công dân hoặc số giấy chứng nhận đăng ký doanh nghiệp, mã số thuế (nếu có), điện thoại và email. Người bán là tổ chức, doanh nghiệp phải hiển thị tên đăng ký kinh doanh trên gian hàng. Thông tin người bán được cung cấp cho người mua khi có yêu cầu hợp lý và cho cơ quan nhà nước có thẩm quyền theo quy định. Việc xác thực danh tính qua hệ thống định danh điện tử quốc gia (VNeID) được áp dụng theo lộ trình của Luật Thương mại điện tử 122/2025/QH15.`,
        en: `Sellers register with a verified phone number or email and must provide complete, accurate information as required: full name or organisation name, address, citizen ID number or enterprise registration number, tax code (if any), phone and email. Business sellers display their registered business name on their storefront. Seller information is provided to buyers on reasonable request and to competent state authorities as required. Identity verification through Vietnam’s national electronic identification system (VNeID) is applied on the timeline set by the Law on E-commerce 122/2025/QH15.`,
      },
      {
        vi: `Người bán chịu trách nhiệm hoàn toàn về tin đăng của mình: mô tả trung thực, dùng ảnh thật của chính hàng hoá hoặc dịch vụ đang rao, niêm yết giá bằng đồng Việt Nam đã bao gồm thuế và bán đúng giá đã niêm yết, cập nhật hoặc gỡ tin ngay khi đã bán hoặc không còn cung cấp, trả lời người mua trung thực và giữ thông tin liên hệ của tài khoản luôn chính xác. Người bán không được chèn số điện thoại, tài khoản mạng xã hội hay thông tin liên hệ khác vào tiêu đề, mô tả hoặc ảnh của tin đăng: việc rà soát, lưu vết bằng chứng và giải quyết khiếu nại phụ thuộc vào việc liên hệ đầu tiên diễn ra trong kênh nhắn tin của sàn.`,
        en: `Sellers are fully responsible for their listings: describe honestly, use real photographs of the actual goods or service offered, list prices in Vietnamese dong inclusive of tax and honour the price listed, update or remove a listing as soon as the item is sold or no longer available, answer buyers truthfully and keep the account’s contact details accurate. Sellers must not put phone numbers, social-media handles or other contact details into a listing’s title, description or images: moderation, evidence and complaint handling all depend on first contact happening in the platform’s messaging.`,
      },
      {
        vi: `Người bán chỉ được đăng những hàng hoá, dịch vụ mà mình có quyền kinh doanh hợp pháp. Đối với hàng hoá, dịch vụ thuộc danh mục ngành, nghề đầu tư kinh doanh có điều kiện, người bán phải đáp ứng đủ điều kiện kinh doanh, phải có giấy phép hoặc giấy chứng nhận đủ điều kiện tương ứng còn hiệu lực, phải cung cấp bản sao các giấy tờ đó cho đơn vị vận hành trước khi tin đăng được duyệt, và phải thông báo ngay khi giấy tờ hết hiệu lực, bị thu hồi hoặc thay đổi. Đơn vị vận hành đối chiếu giấy tờ với nội dung tin đăng, lưu giữ bản sao trong hồ sơ, và công bố công khai tên pháp nhân cung cấp dịch vụ cùng số giấy phép tương ứng ngay tại trang giới thiệu dịch vụ đó. Tin đăng thuộc nhóm kinh doanh có điều kiện mà chưa nộp đủ giấy tờ hợp lệ sẽ không được duyệt hoặc bị gỡ bỏ.`,
        en: `Sellers may list only goods and services they are lawfully entitled to trade. For goods and services in a conditional business sector, the seller must meet the applicable business conditions, must hold the corresponding licence or certificate of eligibility in force, must supply copies of those documents to the operator before the listing is approved, and must notify the operator immediately if they expire, are revoked or change. The operator checks the documents against the listing, keeps copies on file, and publicly displays the name of the legal entity providing the service together with its licence number on the page offering that service. A conditional-business listing without complete, valid documents is not approved, or is taken down.`,
      },
      // SERVICES EDITION ONLY. The partner-of-record disclosure is the concrete case of the
      // conditional-service rule above. The strings come from the aliased module — the marketplace
      // build resolves it to an empty stub, so the partner is neither rendered nor shipped there.
      ...(IS_SERVICES ? [{ vi: PROVIDER_OF_RECORD.vi, en: PROVIDER_OF_RECORD.en }] : []),
      {
        vi: `Người bán không được: đăng hàng hoá, dịch vụ thuộc danh mục cấm tại Điều 9; đăng tin trùng lặp, tin ảo hoặc tin không còn hiệu lực; dùng giá mồi; can thiệp, mua bán hoặc thao túng đánh giá và điểm tín nhiệm; mạo danh cá nhân, tổ chức khác; sử dụng ảnh của người khác như ảnh hàng hoá của mình; hoặc sử dụng sàn cho bất kỳ hành vi lừa đảo, chiếm đoạt tài sản nào.`,
        en: `Sellers must not: list anything prohibited under Article 9; post duplicate, fake or expired listings; use bait pricing; interfere with, buy or manipulate reviews and trust scores; impersonate another person or organisation; pass off someone else’s photographs as their own goods; or use the platform for fraud or misappropriation of any kind.`,
      },
    ],
  },
  {
    id: 'buyers',
    rail: '6. Buyers’ rights & duties',
    titleVi: 'Điều 6. Quyền và nghĩa vụ của người mua',
    titleEn: 'Article 6. Rights and duties of buyers',
    body: [
      {
        vi: `Người mua được tìm kiếm, xem tin đăng và liên hệ người bán miễn phí; được yêu cầu người bán cung cấp thông tin về hàng hoá, dịch vụ và về chính người bán trước khi giao dịch; được đánh giá người bán sau khi giao dịch hoàn tất; và được báo cáo tin đăng, người bán hoặc cuộc trò chuyện có dấu hiệu vi phạm.`,
        en: `Buyers may search, view listings and contact sellers free of charge; may ask a seller for information about the goods or service and about the seller before dealing; may review a seller after a completed transaction; and may report a listing, a seller or a conversation that appears to breach the rules.`,
      },
      {
        vi: `Người mua có nghĩa vụ cung cấp thông tin trung thực khi liên hệ, tự kiểm tra hàng hoá, dịch vụ và tư cách của người bán trước khi thanh toán, tuân thủ pháp luật và Quy chế này, không quấy rối người bán, không đăng đánh giá sai sự thật, và không sử dụng thông tin liên hệ có được trên sàn cho mục đích khác như quảng cáo hay thu thập dữ liệu.`,
        en: `Buyers must give truthful information when making contact, check the goods or service and the seller before paying, comply with the law and these Regulations, not harass sellers, not post untrue reviews, and not use contact details obtained on the platform for other purposes such as advertising or data collection.`,
      },
      {
        vi: `Vì việc thanh toán và bàn giao diễn ra ngoài sàn, người mua nên gặp mặt tại nơi công cộng, kiểm tra kỹ hàng hoá trước khi trả tiền, giữ lại tin nhắn và chứng từ, và không chuyển tiền đặt cọc cho người chưa được xác minh. Hướng dẫn giao dịch an toàn được công bố tại /safety.`,
        en: `Because payment and handover happen off the platform, buyers should meet in a public place, inspect the goods carefully before paying, keep messages and receipts, and not send a deposit to an unverified person. Safe-dealing guidance is published at /safety.`,
      },
    ],
  },
  {
    id: 'process',
    rail: '7. Listing & transaction process',
    titleVi: 'Điều 7. Quy trình đăng tin và giao dịch',
    titleEn: 'Article 7. The listing and transaction process',
    body: [
      {
        vi: `Bước 1 — Đăng ký: người bán tạo tài khoản và xác minh số điện thoại hoặc email. Bước 2 — Đăng tin: người bán nhập tiêu đề, mô tả, danh mục, khu vực, giá bằng đồng Việt Nam và ảnh thật (số lượng ảnh tối thiểu theo từng danh mục); hàng hoá, dịch vụ kinh doanh có điều kiện phải nộp giấy tờ theo Điều 5. Bước 3 — Rà soát: tin đăng đi qua bộ kiểm tra tự động (từ khoá hàng cấm, nội dung vi phạm, tin trùng lặp, thông tin liên hệ chèn trong nội dung, yêu cầu về ảnh) trước khi hiển thị; tin có dấu hiệu rủi ro được chuyển sang rà soát thủ công và có thể bị tạm giữ cho đến khi xử lý xong.`,
        en: `Step 1 — Registration: the seller creates an account and verifies a phone number or email. Step 2 — Posting: the seller enters a title, description, category, area, a price in Vietnamese dong and real photographs (each category has a minimum photo count); conditional goods and services must also supply the documents required by Article 5. Step 3 — Review: the listing passes automated checks (prohibited-keyword filter, infringing content, duplicates, contact details embedded in the text, photo requirements) before it appears; listings showing risk signals go to manual review and may be held until that review is complete.`,
      },
      {
        vi: `Bước 4 — Liên hệ: người mua tìm thấy tin đăng qua tìm kiếm hoặc duyệt danh mục và liên hệ người bán qua kênh nhắn tin trên sàn; nếu người bán cho phép thương lượng, người mua có thể gửi đề nghị giá. Bước 5 — Chốt giao dịch: hai bên tự thoả thuận giá cuối cùng, phương thức thanh toán, thời điểm và địa điểm bàn giao, và tự thực hiện giao dịch ngoài sàn. Bước 6 — Sau giao dịch: người bán đánh dấu tin đã bán; người mua có thể đánh giá người bán; mọi vướng mắc được xử lý theo Điều 12.`,
        en: `Step 4 — Contact: the buyer finds the listing by searching or browsing and contacts the seller through the platform’s messaging; where the seller has allowed negotiation, the buyer may send an offer. Step 5 — Closing: the two parties agree the final price, the payment method and the time and place of handover between themselves, and carry the transaction out off the platform. Step 6 — Afterwards: the seller marks the listing sold; the buyer may review the seller; anything that goes wrong is handled under Article 12.`,
      },
      {
        vi: `Sàn không phát sinh đơn hàng, không xác nhận đơn hàng, không xuất hoá đơn thay người bán và không xử lý thanh toán giữa người mua và người bán ở bất kỳ bước nào. Nghĩa vụ về hoá đơn, chứng từ và thuế phát sinh từ giao dịch thuộc về người bán.`,
        en: `The platform creates no order, confirms no order, issues no invoice on a seller’s behalf and processes no payment between buyer and seller at any step. Invoicing, documentation and any tax arising from a transaction are the seller’s responsibility.`,
      },
    ],
  },
  {
    id: 'fees',
    rail: '8. Fees & payment',
    titleVi: 'Điều 8. Phí dịch vụ và thanh toán',
    titleEn: 'Article 8. Fees and payment',
    body: [
      {
        vi: `Việc đăng tin, duyệt tin và liên hệ người bán trên ${S} hiện miễn phí. Đơn vị vận hành không thu tiền của người mua cho các giao dịch trên sàn, không thanh toán hộ và không giữ tiền của bất kỳ bên nào.`,
        en: `Posting, browsing and contacting sellers on ${S} are currently free. The operator collects no money from buyers for transactions on the platform, makes no payment on anyone’s behalf and holds no one’s money.`,
      },
      {
        vi: `Nếu sau này có dịch vụ thu phí dành cho người bán — ví dụ gói đăng tin hoặc vị trí hiển thị ưu tiên — mức phí, cách tính và phương thức thanh toán sẽ được công bố bằng đồng Việt Nam ít nhất 5 ngày trước ngày áp dụng, và mọi vị trí hiển thị có trả phí đều được gắn nhãn rõ ràng ngay tại vị trí đó.`,
        en: `If paid services for sellers are introduced later — for example posting packages or promoted placement — the price, how it is calculated and how it is paid will be published in Vietnamese dong at least 5 days before they apply, and any paid placement will be clearly labelled where it appears.`,
      },
      {
        vi: `Trường hợp một dịch vụ trên sàn do bên thứ ba có giấy phép cung cấp, khoản mà đơn vị vận hành nhận được là hoa hồng theo hợp đồng với bên cung cấp đó. Người mua thanh toán trực tiếp cho bên cung cấp dịch vụ theo phương thức do bên đó công bố, không thanh toán cho sàn.`,
        en: `Where a service on the platform is provided by a licensed third party, what the operator receives is a commission under its contract with that provider. The buyer pays the provider directly, by the method the provider publishes, not the platform.`,
      },
    ],
  },
  {
    id: 'prohibited',
    rail: '9. Prohibited goods & services',
    titleVi: 'Điều 9. Hàng hoá, dịch vụ không được đăng trên sàn',
    titleEn: 'Article 9. Goods and services that may not be listed',
    body: [
      {
        vi: `Danh mục đầy đủ hàng hoá, dịch vụ không được đăng trên ${S} được công bố tại /prohibited và là một phần không tách rời của Quy chế này. Danh mục bao gồm mọi hàng hoá, dịch vụ mà pháp luật Việt Nam cấm kinh doanh hoặc cấm quảng cáo — vũ khí, vật liệu nổ, công cụ hỗ trợ; ma tuý và chất gây nghiện; thuốc chữa bệnh và thiết bị y tế không phép; rượu, thuốc lá và thuốc lá điện tử; động vật hoang dã và sản phẩm từ động vật hoang dã; hàng giả, hàng nhái, hàng xâm phạm quyền sở hữu trí tuệ, hàng nhập lậu, hàng không rõ nguồn gốc; tiền tệ, giấy tờ tuỳ thân và tài liệu của cơ quan nhà nước; dữ liệu cá nhân; nội dung khiêu dâm, đồi truỵ; dịch vụ tài chính, cho vay không có giấy phép — cùng các nhóm bị cấm theo chính sách riêng của sàn.`,
        en: `The full list of goods and services that may not be listed on ${S} is published at /prohibited and forms an inseparable part of these Regulations. It covers everything Vietnamese law bans from trading or advertising — weapons, explosives and support tools; narcotics and addictive substances; unlicensed medicines and medical devices; alcohol, tobacco and e-cigarettes; wildlife and wildlife products; counterfeits, imitations, goods infringing intellectual property, smuggled goods and goods of unknown origin; currency, identity papers and state authority documents; personal data; pornographic and obscene material; unlicensed financial and lending services — plus the categories banned by the platform’s own policy.`,
      },
      {
        vi: `Hàng hoá, dịch vụ thuộc ngành, nghề kinh doanh có điều kiện chỉ được đăng khi người bán đáp ứng đủ điều kiện và đã nộp giấy tờ hợp lệ theo Điều 5. Tin đăng vi phạm Điều này bị gỡ bỏ; tài khoản vi phạm bị xử lý theo Điều 10.`,
        en: `Goods and services in a conditional business sector may be listed only where the seller meets the conditions and has supplied valid documents under Article 5. A listing that breaches this Article is removed, and the account is dealt with under Article 10.`,
      },
    ],
  },
  {
    id: 'moderation',
    rail: '10. Moderation & enforcement',
    titleVi: 'Điều 10. Rà soát nội dung, gỡ bỏ và biện pháp xử lý vi phạm',
    titleEn: 'Article 10. Content review, takedown and enforcement',
    body: [
      {
        vi: `Mọi tin đăng đều được rà soát tự động trước khi hiển thị và được rà soát lại khi có báo cáo. Đơn vị vận hành sử dụng bộ lọc từ khoá hàng cấm, kiểm tra ảnh trùng và ảnh lấy từ nguồn khác, phát hiện tin trùng lặp và kiểm tra nội dung bằng công cụ tự động, kết hợp rà soát thủ công đối với các trường hợp có dấu hiệu rủi ro. Người sử dụng có thể báo cáo tin đăng, người bán hoặc cuộc trò chuyện bằng nút Báo cáo hiển thị trên từng bề mặt.`,
        en: `Every listing is screened automatically before it appears and is re-reviewed whenever it is reported. The operator uses a prohibited-keyword filter, duplicate- and stolen-image checks, duplicate-listing detection and automated content checks, together with manual review for anything showing risk signals. Users can report a listing, a seller or a conversation with the Report control shown on each surface.`,
      },
      {
        vi: `Khi phát hiện hoặc nhận được phản ánh về hành vi kinh doanh vi phạm pháp luật trên sàn, đơn vị vận hành gỡ bỏ hoặc tạm ẩn nội dung liên quan, thông báo cho người đăng kèm lý do, và phối hợp với cơ quan nhà nước có thẩm quyền. Đối với yêu cầu của cơ quan nhà nước có thẩm quyền, nội dung được gỡ bỏ trong vòng 24 giờ kể từ khi nhận được yêu cầu, và thông tin về người bán vi phạm được cung cấp cho cơ quan có thẩm quyền theo quy định.`,
        en: `Where the operator detects, or is told about, unlawful trading on the platform, it removes or hides the content concerned, notifies the person who posted it with the reason, and cooperates with the competent state authority. Content identified by a competent authority is removed within 24 hours of the request, and information about the infringing seller is provided to that authority as required.`,
      },
      {
        vi: `Chủ thể quyền sở hữu trí tuệ có thể yêu cầu xử lý tin đăng xâm phạm qua nút Báo cáo trên tin đăng hoặc qua email của đơn vị vận hành, kèm tài liệu chứng minh quyền. Yêu cầu có căn cứ dẫn đến gỡ tin và trừ điểm tín nhiệm của người bán; tài khoản tái phạm bị chấm dứt.`,
        en: `Intellectual-property rights holders can ask for an infringing listing to be dealt with through the Report control on the listing or by emailing the operator, with evidence of their rights. A substantiated request leads to removal and a trust-score penalty for the seller; repeat infringers have their accounts terminated.`,
      },
      {
        vi: `Biện pháp xử lý được áp dụng theo mức độ nghiêm trọng và số lần tái phạm, theo thứ tự tăng dần: nhắc nhở; gỡ tin đăng; trừ điểm tín nhiệm; hạn chế tính năng (đăng tin, nhắn tin); tạm khoá tài khoản; chấm dứt tài khoản vĩnh viễn. Người bị áp dụng biện pháp xử lý được thông báo lý do và có quyền khiếu nại một lần kèm bằng chứng theo Điều 12. Cách tính điểm tín nhiệm và bảng trừ điểm được công bố tại /trust.`,
        en: `Enforcement is graduated by severity and repetition: a warning; removal of the listing; a trust-score penalty; feature restrictions (posting, messaging); account suspension; permanent termination. Anyone subject to a measure is told why and may appeal once, with evidence, under Article 12. How the trust score is calculated, and the penalty table, are published at /trust.`,
      },
    ],
  },
  {
    id: 'liability',
    rail: '11. Limits of the platform’s liability',
    titleVi: 'Điều 11. Giới hạn trách nhiệm của đơn vị vận hành sàn',
    titleEn: 'Article 11. Limits of the operator’s liability',
    body: [
      {
        vi: `Đơn vị vận hành không phải người bán, không phải người mua và không phải trung gian thanh toán trong các giao dịch trên sàn. Đơn vị vận hành không chịu trách nhiệm về chất lượng, số lượng, nguồn gốc, tính hợp pháp của hàng hoá, dịch vụ do người bán cung cấp, cũng như về việc giao nhận và việc thực hiện nghĩa vụ của các bên trong giao dịch. Đơn vị vận hành không phải cơ quan nhà nước và không bảo đảm kết quả của bất kỳ dịch vụ nào do người bán hoặc bên thứ ba cung cấp. Huy hiệu xác minh và điểm tín nhiệm là thông tin tham khảo được tính từ dữ liệu hoạt động, không phải sự bảo lãnh, chứng nhận chất lượng hay cam kết của sàn về một giao dịch cụ thể.`,
        en: `The operator is not the seller, not the buyer and not a payment intermediary in transactions on the platform. It is not responsible for the quality, quantity, origin or legality of the goods and services sellers offer, nor for handover or for either party performing its obligations. The operator is not a state authority and does not guarantee the outcome of any service provided by a seller or by a third party. Verification badges and trust scores are indicative information computed from activity data — not a guarantee, a quality certification, or any commitment by the platform about a particular transaction.`,
      },
      {
        vi: `Giới hạn trách nhiệm nêu trên không loại trừ trách nhiệm của đơn vị vận hành theo quy định pháp luật, bao gồm nghĩa vụ rà soát và gỡ bỏ nội dung vi phạm khi biết hoặc buộc phải biết, nghĩa vụ cung cấp thông tin cho cơ quan nhà nước có thẩm quyền, nghĩa vụ bảo vệ dữ liệu cá nhân, và các quyền mà pháp luật bảo vệ quyền lợi người tiêu dùng dành cho người mua.`,
        en: `These limits do not exclude the operator’s obligations under the law, including the duty to review and remove infringing content once it knows or ought to know of it, the duty to provide information to competent state authorities, the duty to protect personal data, and the rights that consumer-protection law gives buyers.`,
      },
    ],
  },
  {
    id: 'complaints',
    rail: '12. Complaints & disputes',
    titleVi: 'Điều 12. Tiếp nhận và giải quyết khiếu nại, tranh chấp',
    titleEn: 'Article 12. Complaints and dispute resolution',
    body: [
      {
        vi: `Người sử dụng gửi phản ánh, khiếu nại qua nút Báo cáo hiển thị trên tin đăng, trên trang người bán và trong cuộc trò chuyện, hoặc qua email ${COMPANY.email}. Thời hạn được công bố: xác nhận đã tiếp nhận trong vòng 3 ngày làm việc; trả lời kết quả xử lý trong vòng 15 ngày làm việc kể từ ngày tiếp nhận; trường hợp phức tạp cần xác minh thêm, thời hạn có thể kéo dài nhưng không quá 30 ngày làm việc và người khiếu nại được thông báo lý do kéo dài. Đơn vị vận hành không thu phí đối với việc tiếp nhận và giải quyết khiếu nại.`,
        en: `Users submit reports and complaints through the Report control shown on listings, on seller pages and in conversations, or by emailing ${COMPANY.email}. The published deadlines are: acknowledgement within 3 working days; an answer with the outcome within 15 working days of receipt; and, where the matter is complex and needs further verification, an extension of no more than 30 working days, with the reason for the extension given to the complainant. The operator charges nothing for receiving or handling a complaint.`,
      },
      {
        vi: `Quy trình xử lý: (1) tiếp nhận và phân loại khiếu nại; (2) yêu cầu người khiếu nại bổ sung bằng chứng nếu cần; (3) chuyển nội dung khiếu nại cho bên bị khiếu nại và yêu cầu phản hồi trong vòng 7 ngày làm việc; (4) đối chiếu bằng chứng của hai bên; (5) kết luận khiếu nại là có căn cứ hoặc không có căn cứ và áp dụng biện pháp xử lý theo Điều 10; (6) thông báo kết quả cho người khiếu nại. Bên bị áp dụng biện pháp xử lý được khiếu nại lại một lần kèm bằng chứng mới. Danh tính của người báo cáo không được tiết lộ cho bên bị báo cáo.`,
        en: `The procedure is: (1) receive and classify the complaint; (2) ask the complainant for further evidence if needed; (3) put the complaint to the party complained of and require a response within 7 working days; (4) weigh both sides’ evidence; (5) conclude the complaint substantiated or unsubstantiated and apply any measure under Article 10; (6) notify the complainant of the outcome. A party subject to a measure may appeal once, with new evidence. The identity of the person who reported is never disclosed to the party reported.`,
      },
      {
        vi: `Tranh chấp phát sinh từ giao dịch giữa người mua và người bán trước hết do hai bên tự thương lượng. Đơn vị vận hành hỗ trợ bằng cách mở phòng xử lý tranh chấp trên sàn khi cần, cung cấp cho các bên và cho cơ quan có thẩm quyền các dữ liệu liên quan trong phạm vi pháp luật cho phép (nội dung tin nhắn, tin đăng, lịch sử thay đổi giá), và khuyến khích các bên hoà giải. Nếu không tự giải quyết được, các bên có quyền yêu cầu hoà giải, khiếu nại đến cơ quan hoặc tổ chức bảo vệ quyền lợi người tiêu dùng, hoặc khởi kiện tại Toà án có thẩm quyền của Việt Nam. Người tiêu dùng giữ nguyên mọi quyền mà pháp luật Việt Nam dành cho mình.`,
        en: `A dispute arising from a transaction between a buyer and a seller is first for the two parties to settle between themselves. The operator assists by opening a dispute room on the platform where appropriate, by giving the parties and the competent authorities the relevant data the law permits it to share (message content, the listing, price-change history), and by encouraging settlement. If the parties cannot settle, they may seek mediation, complain to a consumer-protection authority or organisation, or bring the matter before the competent Vietnamese court. Consumers keep every right Vietnamese law gives them.`,
      },
    ],
  },
  {
    id: 'privacy',
    rail: '13. Personal data & security',
    titleVi: 'Điều 13. Bảo vệ dữ liệu cá nhân và an toàn thông tin',
    titleEn: 'Article 13. Personal data protection and information security',
    body: [
      {
        vi: `Việc thu thập, sử dụng, lưu trữ và chuyển giao dữ liệu cá nhân được thực hiện theo Chính sách bảo vệ dữ liệu cá nhân công bố tại /privacy — một phần không tách rời của Quy chế này — và theo Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15. Đơn vị vận hành chỉ thu thập dữ liệu cần thiết cho mục đích đã thông báo, xin sự đồng ý của chủ thể dữ liệu trong các trường hợp pháp luật yêu cầu, và không bán dữ liệu cá nhân của người sử dụng.`,
        en: `Collecting, using, storing and transferring personal data is governed by the Personal Data Protection Policy published at /privacy — an inseparable part of these Regulations — and by the Law on Personal Data Protection 91/2025/QH15. The operator collects only the data needed for the purposes it has notified, obtains the data subject’s consent where the law requires it, and does not sell users’ personal data.`,
      },
      {
        vi: `Chủ thể dữ liệu có quyền truy cập, chỉnh sửa, rút lại sự đồng ý, yêu cầu xoá dữ liệu và yêu cầu ngừng xử lý dữ liệu của mình. Yêu cầu gửi về ${COMPANY.privacyEmail} được xác nhận trong vòng 2 ngày làm việc và được xử lý trong thời hạn pháp luật quy định. Tài khoản có thể được xoá theo yêu cầu, trừ phần dữ liệu mà pháp luật buộc phải lưu giữ.`,
        en: `Data subjects may access and correct their data, withdraw consent, ask for erasure and ask for processing to stop. Requests sent to ${COMPANY.privacyEmail} are acknowledged within 2 working days and handled within the period the law prescribes. An account can be deleted on request, except for data the law requires to be retained.`,
      },
      {
        vi: `Đơn vị vận hành áp dụng các biện pháp kỹ thuật và tổ chức để bảo vệ hệ thống và dữ liệu, gồm mã hoá dữ liệu trên đường truyền, kiểm soát truy cập theo vai trò đối với công cụ quản trị, giới hạn tần suất truy cập nhằm chống lạm dụng, và sao lưu định kỳ. Hồ sơ, chứng từ liên quan đến hoạt động của sàn được lưu trữ tối thiểu 3 năm kể từ ngày phát sinh theo quy định.`,
        en: `The operator applies technical and organisational measures to protect its systems and data, including encryption of data in transit, role-based access control for administrative tools, rate limiting against abuse, and regular backups. Records relating to the platform’s operation are retained for at least 3 years from the date they arise, as required.`,
      },
    ],
  },
  {
    id: 'ranking',
    rail: '14. How listings are ranked',
    titleVi: 'Điều 14. Tiêu chí sắp xếp và hiển thị tin đăng',
    titleEn: 'Article 14. Criteria for sorting and displaying listings',
    body: [
      {
        vi: `Thực hiện nghĩa vụ công bố công khai tiêu chí phân loại và hiển thị, đơn vị vận hành công bố các tiêu chí sau. Thứ tự hiển thị mặc định khi duyệt danh mục được xác định bởi ba nhóm tiêu chí, xếp theo mức độ ảnh hưởng giảm dần: (1) mức độ tin cậy của người bán, tính từ dữ liệu hoạt động đã xác minh gồm xác minh số điện thoại và danh tính, lịch sử bán hàng, đánh giá của người mua, tỷ lệ và tốc độ phản hồi, cùng số vi phạm đã được xác nhận; (2) mức độ quan tâm của người mua đối với tin đăng, gồm lượt xem và số lượt liên hệ; (3) tính mới, trong đó tin đăng hoặc tin vừa được cập nhật gần đây được ưu tiên hơn.`,
        en: `In discharge of the duty to publish its classification and display criteria, the operator discloses the following. The default ordering when browsing a category is determined by three groups of criteria, in decreasing order of influence: (1) how trustworthy the seller is, computed from verified activity data — phone and identity verification, selling history, buyer reviews, response rate and speed, and confirmed violations; (2) how much buyer interest the listing has attracted, namely views and contacts; (3) recency, where newer or recently updated listings rank higher.`,
      },
      {
        vi: `Trong kết quả tìm kiếm, các tiêu chí trên được kết hợp thêm với mức độ phù hợp giữa từ khoá tìm kiếm và nội dung tin đăng (tiêu đề, mô tả, danh mục, thương hiệu, khu vực). Người sử dụng có thể tự chọn cách sắp xếp khác — mới nhất, giá tăng dần, giá giảm dần — và có thể lọc theo danh mục, khu vực, khoảng giá cùng các thuộc tính khác; khi người sử dụng đã chọn, lựa chọn đó được ưu tiên áp dụng thay cho thứ tự mặc định.`,
        en: `In search results, the criteria above are combined with how well the listing (title, description, category, brand, area) matches the query. Users can choose a different ordering themselves — newest, price ascending, price descending — and can filter by category, area, price range and other attributes; where the user has chosen, that choice is applied instead of the default ordering.`,
      },
      {
        vi: `Hiện tại không có vị trí hiển thị nào được bán hoặc trả phí để nâng thứ hạng. Nếu sau này có, vị trí đó được gắn nhãn “Quảng cáo” hoặc “Tin ưu tiên” ngay tại chỗ hiển thị. Trọng số cụ thể của thuật toán không được công bố nhằm tránh bị thao túng; toàn bộ tiêu chí được công bố tại Điều này, và cách tính điểm tín nhiệm của người bán được công bố chi tiết tại /trust.`,
        en: `No display position is currently sold, and no one can pay to rank higher. If that changes, such positions are labelled “Advertisement” or “Promoted” where they appear. The algorithm’s specific weights are not published, so that ranking cannot be gamed; the criteria themselves are published in full in this Article, and how a seller’s trust score is calculated is published in detail at /trust.`,
      },
    ],
  },
  {
    id: 'amendments',
    rail: '15. Amendments & governing law',
    titleVi: 'Điều 15. Sửa đổi Quy chế, luật áp dụng và hiệu lực',
    titleEn: 'Article 15. Amendments, governing law and effect',
    body: [
      {
        vi: `Đơn vị vận hành có quyền sửa đổi, bổ sung Quy chế này khi pháp luật hoặc sản phẩm thay đổi. Mọi sửa đổi được công bố công khai trên sàn ít nhất 5 ngày trước ngày có hiệu lực, kèm thông báo tới người sử dụng đã đăng ký tài khoản. Bản Quy chế đang áp dụng luôn được đăng tại /regulations kèm số phiên bản.`,
        en: `The operator may amend these Regulations when the law or the product changes. Every amendment is published on the platform at least 5 days before it takes effect, together with a notice to registered users. The version in force is always published at /regulations with its version number.`,
      },
      {
        vi: `Người sử dụng tiếp tục sử dụng ${S} sau ngày bản sửa đổi có hiệu lực được coi là chấp nhận bản sửa đổi đó. Người không đồng ý có quyền ngừng sử dụng dịch vụ và yêu cầu xoá tài khoản.`,
        en: `A user who continues to use ${S} after an amended version takes effect is taken to have accepted it. A user who does not agree may stop using the service and ask for their account to be deleted.`,
      },
      {
        vi: `Quy chế này được điều chỉnh bởi pháp luật Việt Nam. Trường hợp có khác biệt giữa bản tiếng Việt và bản dịch tiếng Anh, bản tiếng Việt có giá trị áp dụng. Nếu bất kỳ điều khoản nào của Quy chế bị coi là vô hiệu, các điều khoản còn lại vẫn giữ nguyên hiệu lực. Quy chế có hiệu lực kể từ ngày được công bố trên ${S} và thay thế các phiên bản trước đó.`,
        en: `These Regulations are governed by the law of Vietnam. If the Vietnamese text and the English translation differ, the Vietnamese text prevails. If any provision is held invalid, the remaining provisions stay in force. These Regulations take effect on the day they are published on ${S} and replace all earlier versions.`,
      },
    ],
  },
  {
    id: 'documents',
    rail: '16. Related documents',
    titleVi: 'Điều 16. Các văn bản kèm theo',
    titleEn: 'Article 16. Documents published alongside these Regulations',
    body: [
      {
        vi: `Các văn bản sau được công bố trên ${S} và là một phần không tách rời của Quy chế này: Điều khoản dịch vụ, Chính sách bảo vệ dữ liệu cá nhân, Danh mục hàng hoá và dịch vụ cấm đăng, cách tính điểm tín nhiệm, và Hướng dẫn giao dịch an toàn. Trường hợp có mâu thuẫn giữa một văn bản kèm theo và Quy chế này, Quy chế này được áp dụng.`,
        en: `The following documents are published on ${S} and form an inseparable part of these Regulations: the Terms of Service, the Personal Data Protection Policy, the list of prohibited goods and services, how the trust score is calculated, and the safe-dealing guidance. Where a document conflicts with these Regulations, these Regulations prevail.`,
      },
    ],
    links: [
      { href: '/terms', label: 'Điều khoản dịch vụ / Terms of Service' },
      { href: '/privacy', label: 'Bảo vệ dữ liệu cá nhân / Privacy Policy' },
      { href: '/prohibited', label: 'Hàng hoá, dịch vụ cấm đăng / Prohibited items' },
      { href: '/trust', label: 'Điểm tín nhiệm / Trust score' },
      { href: '/safety', label: 'Giao dịch an toàn / Safe dealing' },
    ],
  },
]

export const metadata: Metadata = {
  title: `Quy chế hoạt động | Operating Regulations | ${SITE_NAME}`,
  description: `Quy chế hoạt động sàn giao dịch thương mại điện tử ${SITE_NAME}: phạm vi hoạt động, quyền và nghĩa vụ của các bên, quy trình đăng tin, rà soát nội dung, khiếu nại và tiêu chí hiển thị. Operating regulations of the ${SITE_NAME} e-commerce platform.`,
  alternates: { canonical: '/regulations' },
}

// ⚠️ ContentPage renders `intro` INSIDE a <p>, so only phrasing content may be passed to it —
// <span className="block">, never a <div> or a nested <p>. `meta` is a sibling of the <h1> and has
// no such constraint.
export default function RegulationsPage() {
  return (
    <ContentPage
      title="Quy chế hoạt động (Operating Regulations)"
      meta={
        <div className="mt-3 max-w-[70ch] space-y-1">
          <p className="text-sm text-ink-4" lang="vi">{META.vi}</p>
          <p className="text-sm text-ink-4" lang="en">{META.en}</p>
        </div>
      }
      intro={
        <>
          <span className="block" lang="vi">{INTRO.vi}</span>
          <span className="mt-3 block text-sm text-ink-4" lang="en">{INTRO.en}</span>
        </>
      }
      sections={ARTICLES.map((a) => ({ id: a.id, label: a.rail }))}
    >
      {ARTICLES.map((a) => (
        <ContentSection key={a.id} id={a.id}>
          <div>
            <h2 className="h-section text-foreground" lang="vi">{a.titleVi}</h2>
            <p className="mt-1 text-sm font-medium text-ink-4" lang="en">{a.titleEn}</p>
          </div>
          {a.body.map((p, i) => (
            <div key={i} className="space-y-1.5">
              <p className="text-base leading-relaxed text-body" lang="vi">{p.vi}</p>
              <p className="text-sm leading-relaxed text-ink-4" lang="en">{p.en}</p>
            </div>
          ))}
          {a.links && (
            <ul className="flex flex-wrap gap-x-6 gap-y-2">
              {a.links.map((l) => (
                <li key={l.href}>
                  <a href={l.href} className="text-sm font-semibold text-accent-foreground hover:underline">{l.label}</a>
                </li>
              ))}
            </ul>
          )}
        </ContentSection>
      ))}
    </ContentPage>
  )
}
