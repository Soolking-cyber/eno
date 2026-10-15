import { IS_MARKETPLACE, IS_SERVICES, SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import { withShare } from '@/lib/site-identity'
import { Tr } from '@/context/language-context'
import { ContentPage, ContentSection } from '@/components/marketplace/content-page'
import { Bilingual } from '@/components/marketplace/bilingual'
import { LegalLanguageNote } from '@/components/legal/legal-language-note'
// ⚠️ "LAST UPDATED" IS /prohibited's OWN AMENDMENT (PROHIBITED_AMENDMENT, owner 2026-10-14 — the e-Visa rules on
// eno.vn) — never LEGAL_AMENDMENT or REGULATIONS_AMENDMENT, whose amendments do not change this list. (Until then it
// was the October 2026 amendment's date, a literal in legal-archive.ts.)
import { PROHIBITED_AMENDED, PROHIBITED_AMENDMENT } from '@/lib/compliance/legal-amendment'
import { CROSS_SITE_REL } from '@/lib/cross-site-links'
import { PROHIBITED_SERVICES_CROSSLINK } from '@/lib/prohibited-services-copy'

export const metadata: Metadata = withShare({
  title: `Prohibited items & services | Hàng hóa & dịch vụ cấm | ${SITE_NAME}`,
  description: `Goods and services that must not be listed on ${SITE_NAME}, per Vietnamese law and platform policy.`,
  alternates: { canonical: '/prohibited' },
})

// ── Prohibited goods & services (part of the Operating Regulations) ─────────────
// Legal basis: Investment Law banned lines (as amended by Law 143/2025), Decree
// 98/2020, Weapons Law 42/2024, Pharmacy Law, Alcohol Law 44/2019, Resolution
// 173/2024 (vapes = banned goods), Advertising Law Art 7, CITES decrees, PDP Law
// 91/2025 Art 7. Mirrors market practice (Chợ Tốt/Shopee prohibited lists).
// Enforcement: automated banned-word screening at posting + reports + removal.
//
// ⚠️ THE FOUR SHARED GROUPS BELOW ARE COLLISION-CHECKED AGAINST A LIVE FILTER. They mirror
// BANNED_WORDS in src/lib/publish-guard.ts, whose terms were each tested against real listings
// ("bang gia" hits price lists, "ruou vang" hits wine fridges — deliberately EXCLUDED). Rewording
// an item here is free; adding a category because it "should" be screened is not, and the filter is
// not this page's to change. Prose only.
//
// ⚠️ THIS PAGE RENDERS ON BOTH EDITIONS. eno.vn (the licensed sàn TMĐT) and eno.forum share this one
// file, so every shared string has to be true on both — which is why the site names itself through
// SITE_NAME rather than saying "eno.vn".
//
// ⛔ THE e-VISA RULES (VISA_RULES) RENDER ON BOTH EDITIONS SINCE 2026-10-14 — the owner's exception
// (CLAUDE.md, the e-Visa subcategory: "Anyone posts, live after check"; eno.vn's /prohibited gets the same visa
// rules, dated, with 5 days' notice — PROHIBITED_AMENDMENT). Before, they were eno.forum-only, in the aliased
// @/lib/prohibited-services-copy. Rules for them:
//   · They stay OUT of the four collision-checked GROUPS and out of publish-guard's BANNED_WORDS: they are enforced
//     by eno's licence check, reports and removal, and the page never says they are screened automatically.
//   · They are OBLIGATIONS ON WHOEVER POSTS, never claims of checks already made ("the business must give us a copy
//     of its licence" is a rule; PROVIDER_LICENCE_ON_FILE in src/lib/visa-provider.ts is what we hold).
//   · They name no company, partner or licence number.
//   · They reach the page through say() from variables, and this directory is outside gen-ui-strings' PAIR_SCOPE,
//     so none of it enters the shared catalogue.
// Only eno.forum's note about eno.vn stays in the aliased module: on eno.vn it would be the page linking to itself.
//
// ⚠️ CURATED VIETNAMESE, RENDERED ON THE SERVER (2026-10-01). Every shared string is an {en, vi} pair:
// the `vi` variant prints the curated text into the server HTML, `en` and the nine machine-translated
// languages keep `<Tr text={en}>`. Those `<Tr>` calls take a VARIABLE, so scripts/gen-ui-strings.mjs
// harvests none of this copy (it only sees literals): do not inline it as literals.

type Pair = { en: string; vi: string }

const GROUPS: { id: string; title: string; titleVi: string; items: Pair[] }[] = [
  {
    id: 'illegal',
    title: 'Illegal under Vietnamese law — never allowed',
    titleVi: 'Bị pháp luật Việt Nam cấm — tuyệt đối không được đăng',
    items: [
      { en: 'Drugs, drug precursors, laughing gas (bong cuoi)', vi: 'Ma tuý, tiền chất ma tuý, khí cười (bóng cười)' },
      {
        en: 'Weapons of any kind: firearms, ammunition, explosives, fireworks (all, including genuine Z121 resale), crude weapons (machetes, swords, crossbows, knuckledusters), stun guns, pepper spray, batons, handcuffs',
        vi: 'Vũ khí dưới mọi hình thức: súng, đạn, vật liệu nổ, pháo (mọi loại, kể cả bán lại pháo hoa chính hãng của Z121), vũ khí thô sơ (mã tấu, kiếm, nỏ, nắm đấm thép), súng điện, bình xịt hơi cay, dùi cui, còng tay',
      },
      { en: 'Military and police uniforms, insignia and equipment', vi: 'Quân phục, trang phục công an, phù hiệu, cấp hiệu và trang thiết bị của quân đội, công an' },
      { en: 'E-cigarettes, vapes and heated tobacco products (banned goods since 1 Jan 2025)', vi: 'Thuốc lá điện tử, vape và thuốc lá nung nóng (hàng cấm từ ngày 01/01/2025)' },
      {
        en: 'Wildlife and wildlife products: ivory, rhino horn, tiger and pangolin products, bear bile, live wild animals (CITES)',
        vi: 'Động vật hoang dã và sản phẩm từ động vật hoang dã: ngà voi, sừng tê giác, sản phẩm từ hổ và tê tê, mật gấu, động vật hoang dã còn sống (theo CITES)',
      },
      {
        en: 'Counterfeit or fake goods of any kind; fake documents, diplomas, seals, invoices (VAT invoices)',
        vi: 'Hàng giả, hàng nhái dưới mọi hình thức; giấy tờ, văn bằng, con dấu, hoá đơn (hoá đơn GTGT) giả',
      },
      { en: 'Currency, counterfeit money, unlicensed foreign exchange, gold bars', vi: 'Tiền tệ, tiền giả, mua bán ngoại tệ trái phép, vàng miếng' },
      { en: 'Pre-activated or pre-registered SIM cards; phone numbers sold separately', vi: 'SIM đã kích hoạt hoặc đã đăng ký thông tin sẵn; mua bán riêng số điện thoại' },
      {
        en: 'Personal data, customer lists or databases (prohibited by the Personal Data Protection Law)',
        vi: 'Dữ liệu cá nhân, danh sách khách hàng hoặc cơ sở dữ liệu (bị cấm theo Luật Bảo vệ dữ liệu cá nhân)',
      },
      {
        en: 'Human organs and tissue; pornographic or anti-state material; gambling machines and lottery tickets',
        vi: 'Bộ phận cơ thể và mô người; văn hoá phẩm đồi truỵ hoặc chống phá Nhà nước; máy đánh bạc và vé số',
      },
      { en: 'Hidden cameras, eavesdropping devices, speed-camera jammers', vi: 'Camera quay lén, thiết bị nghe lén, thiết bị gây nhiễu camera bắn tốc độ' },
      {
        en: 'Vehicles without legal papers; license plates or vehicle documents sold separately; stolen goods',
        vi: 'Xe không có giấy tờ hợp pháp; mua bán riêng biển số hoặc giấy tờ xe; hàng do trộm cắp mà có',
      },
    ],
  },
  {
    id: 'regulated',
    title: 'Legal to own, but cannot be sold person-to-person online',
    titleVi: 'Được phép sở hữu nhưng không được mua bán trực tuyến giữa cá nhân với nhau',
    items: [
      {
        en: `Medicines of every kind — prescription, over-the-counter and herbal (online sale is restricted to licensed pharmacies with ordering functions, which ${SITE_NAME} does not provide)`,
        vi: `Thuốc chữa bệnh mọi loại — thuốc kê đơn, thuốc không kê đơn và thuốc dược liệu (chỉ nhà thuốc được cấp phép, có chức năng đặt hàng trực tuyến, mới được bán qua mạng; ${SITE_NAME} không có chức năng này)`,
      },
      {
        en: 'Alcohol of any strength, including beer (online sale requires a trader license, buyer age gates and non-cash payment — impossible in a P2P classifieds format)',
        vi: 'Đồ uống có cồn ở mọi nồng độ, kể cả bia (bán trực tuyến đòi hỏi giấy phép kinh doanh, kiểm soát độ tuổi người mua và thanh toán không dùng tiền mặt — điều hình thức rao vặt giữa cá nhân không đáp ứng được)',
      },
      {
        en: 'Tobacco, cigars and shisha (licensed fixed-premises trade only; advertising is banned entirely)',
        vi: 'Thuốc lá, xì gà và shisha (chỉ được kinh doanh tại địa điểm cố định có giấy phép; cấm hoàn toàn việc quảng cáo)',
      },
      { en: 'Prescription medical devices, contact lenses, hearing aids', vi: 'Thiết bị y tế cần kê đơn, kính áp tròng, máy trợ thính' },
      {
        en: 'Breast-milk substitutes (formula) for children under 24 months, feeding bottles and teats (advertising is banned by law)',
        vi: 'Sản phẩm dinh dưỡng thay thế sữa mẹ dành cho trẻ dưới 24 tháng tuổi, bình bú và vú ngậm nhân tạo (pháp luật cấm quảng cáo)',
      },
      {
        en: 'Agro-chemicals and pesticides; industrial explosives and precursors',
        vi: 'Hoá chất nông nghiệp và thuốc bảo vệ thực vật; vật liệu nổ công nghiệp và tiền chất thuốc nổ',
      },
    ],
  },
  {
    id: 'policy',
    title: 'Additional platform policy bans',
    titleVi: 'Mặt hàng bị cấm theo chính sách riêng của sàn',
    items: [
      {
        en: 'Used underwear and intimates; ingestible cosmetics and supplements without a valid declaration number',
        vi: 'Đồ lót đã qua sử dụng; mỹ phẩm dùng qua đường uống và thực phẩm bổ sung không có số công bố hợp lệ',
      },
      { en: 'Recalled or expired products; food past its safe life', vi: 'Sản phẩm bị thu hồi hoặc đã hết hạn sử dụng; thực phẩm đã quá hạn an toàn' },
      { en: 'Dog and cat meat; placenta and human-derived products', vi: 'Thịt chó, thịt mèo; nhau thai và sản phẩm có nguồn gốc từ cơ thể người' },
      { en: 'Superstition items marketed with health or fortune claims', vi: 'Vật phẩm mê tín được quảng cáo là chữa bệnh hoặc mang lại may mắn' },
      { en: 'Game accounts and in-game currency; like-farming and follower services', vi: 'Tài khoản game và tiền tệ trong game; dịch vụ tăng lượt thích, tăng người theo dõi' },
      { en: 'Ride-hailing and delivery uniforms and account kits', vi: 'Đồng phục và bộ tài khoản của tài xế xe công nghệ, giao hàng' },
      {
        en: 'Maps or publications misrepresenting Vietnam’s sovereignty; heritage artifacts',
        vi: 'Bản đồ hoặc ấn phẩm thể hiện sai chủ quyền của Việt Nam; cổ vật, di vật',
      },
    ],
  },
  {
    id: 'services',
    title: 'Services that must not be offered',
    titleVi: 'Dịch vụ không được cung cấp',
    items: [
      {
        en: 'Lending, debt rollover (dao han), debt collection, currency exchange or remittance services',
        vi: 'Cho vay, đáo hạn, đòi nợ thuê, đổi ngoại tệ hoặc chuyển tiền',
      },
      { en: 'Multi-level marketing (MLM) recruitment; investment schemes', vi: 'Tuyển người tham gia kinh doanh đa cấp; mời gọi góp vốn đầu tư' },
      {
        en: 'Matchmaking, dating or escort services; jobs at adult venues',
        vi: 'Dịch vụ mai mối, hẹn hò hoặc “đi kèm”; việc làm tại cơ sở giải trí dành cho người lớn',
      },
      {
        en: 'Any job employing children under 15; unlicensed labor-export services',
        vi: 'Mọi công việc sử dụng trẻ em dưới 15 tuổi; dịch vụ đưa người lao động đi làm việc ở nước ngoài không có giấy phép',
      },
      {
        en: 'Sale or preparation of fake diplomas, documents or seals; private investigation and tracking services',
        vi: 'Mua bán hoặc làm giả văn bằng, giấy tờ, con dấu; dịch vụ thám tử tư và theo dõi người khác',
      },
      { en: 'Insurance products (licensed distribution only)', vi: 'Sản phẩm bảo hiểm (chỉ được phân phối qua đơn vị có giấy phép)' },
    ],
  },
]

const INTRO: Pair = {
  en: `These goods and services must never be listed on ${SITE_NAME} — because Vietnamese law bans trading or advertising them, or because platform policy does. Listings posted here are screened automatically when posted and removed when reported, and the same list applies to linked listings: one found to offer anything below is taken off the platform. Posting them leads to removal, trust penalties and, for serious or repeated violations, account bans — and may be reported to authorities where the law requires.`,
  vi: `Không được đăng các hàng hoá, dịch vụ dưới đây trên ${SITE_NAME} — vì pháp luật Việt Nam cấm kinh doanh hoặc quảng cáo chúng, hoặc vì chính sách của sàn cấm. Tin đăng trực tiếp trên sàn được sàng lọc tự động khi đăng và bị gỡ khi bị báo cáo; danh mục này cũng áp dụng cho tin đăng liên kết: tin liên kết chào bán bất kỳ mục nào dưới đây sẽ bị gỡ khỏi sàn. Đăng các mặt hàng này dẫn đến việc gỡ tin, trừ điểm uy tín và, với vi phạm nghiêm trọng hoặc tái phạm, khoá tài khoản — và có thể bị báo cho cơ quan chức năng khi pháp luật yêu cầu.`,
}

const ENFORCEMENT: Pair = {
  en: 'Every new listing posted here passes an automated screen (banned-keyword filter, photo requirement, contact-in-text scan) before going live, and every listing can be reported by any user. Confirmed violations are removed, the seller’s trust score is docked per the published penalty table, and repeat or severe violations escalate through restriction to a permanent ban. Content identified by a competent state authority is removed within 24 hours of the request. If you spot something that should not be here, use the Report button — it genuinely helps.',
  vi: 'Mọi tin mới đăng trực tiếp trên sàn đều qua bước sàng lọc tự động (bộ lọc từ khoá hàng cấm, yêu cầu về ảnh, kiểm tra thông tin liên hệ chèn trong nội dung) trước khi hiển thị, và bất kỳ người dùng nào cũng có thể báo cáo một tin đăng. Vi phạm đã được xác nhận sẽ bị gỡ, người bán bị trừ điểm uy tín theo bảng trừ điểm đã công bố, và vi phạm lặp lại hoặc nghiêm trọng bị xử lý tăng dần từ hạn chế tính năng đến khoá tài khoản vĩnh viễn. Nội dung do cơ quan nhà nước có thẩm quyền xác định là vi phạm được gỡ trong vòng 24 giờ kể từ khi nhận được yêu cầu. Nếu thấy nội dung không nên có ở đây, hãy dùng nút Báo cáo — việc đó thực sự có ích.',
}

/**
 * THE VISA & IMMIGRATION LISTING RULES — on both editions since 2026-10-14 (the header says why). Written in the
 * register of the rest of the page: a plain rule first, then the reason it exists. Licence, no promised outcome and
 * the government fee shown separately are items 1, 2 and 4; the others close the routes a reader would otherwise
 * find open (impersonating an official channel, working around the process, moving documents or money off the
 * route the listing describes). The English is eno.forum's text since August, moved here — the intro now states the
 * rule ("may be listed here only by …") where it used to state a fact ("are listed here by …"; codex, commit gate).
 * ⛔ DRAFT FOR COUNSEL — the Vietnamese is curated, and like the rest of this page it is under review
 * (LEGAL_VI_APPROVED, <LegalLanguageNote />).
 */
const VISA_RULES: { title: string; titleVi: string; intro: Pair; items: Pair[] } = {
  title: 'Visa & immigration services — extra rules',
  titleVi: 'Dịch vụ thị thực và xuất nhập cảnh — quy định bổ sung',
  intro: {
    en: 'Vietnam e-visa and immigration services may be listed here only by licensed third-party providers: the provider named on a listing does the work under its own licence, and this site is the platform the listing sits on. A mistake in this category costs someone a trip or an entry refusal, so these listings carry rules on top of everything above — and the rules apply to the listing, its photos, its price and to what is said in chat.',
    vi: 'Dịch vụ thị thực điện tử (e-Visa) và xuất nhập cảnh Việt Nam chỉ được đăng tại đây bởi các nhà cung cấp là bên thứ ba có giấy phép: nhà cung cấp có tên trên tin đăng thực hiện công việc theo giấy phép của chính mình, còn website này là nền tảng nơi tin đăng được hiển thị. Một sai sót trong nhóm dịch vụ này có thể khiến người khác lỡ chuyến đi hoặc bị từ chối nhập cảnh, vì vậy ngoài mọi quy định nêu trên, các tin đăng này còn phải tuân thủ các quy định dưới đây — áp dụng cho tin đăng, ảnh, giá và cả nội dung trao đổi trong cuộc trò chuyện.',
  },
  items: [
    {
      en: 'Only a licensed business may list them. Vietnam visa, immigration, residence-card and work-permit services may be listed only by a business holding the Vietnamese licence that work requires — for visa and travel services, a valid international travel-service licence. That business must be named as the provider on the listing itself and must give us a copy of its licence and its business registration before the listing goes live. Individuals, unlicensed "visa agents" and resellers may not offer these services here, and a listing we cannot tie to a current licence is removed.',
      vi: 'Chỉ doanh nghiệp có giấy phép mới được đăng. Dịch vụ thị thực, xuất nhập cảnh, thẻ tạm trú và giấy phép lao động tại Việt Nam chỉ được đăng bởi doanh nghiệp có giấy phép mà pháp luật Việt Nam yêu cầu đối với công việc đó — với dịch vụ thị thực và du lịch là giấy phép kinh doanh dịch vụ lữ hành quốc tế còn hiệu lực. Doanh nghiệp đó phải được ghi tên là nhà cung cấp ngay trên tin đăng và phải gửi cho chúng tôi bản sao giấy phép và giấy chứng nhận đăng ký doanh nghiệp trước khi tin đăng được hiển thị. Cá nhân, “đại lý visa” không có giấy phép và người bán lại không được cung cấp các dịch vụ này tại đây; tin đăng mà chúng tôi không đối chiếu được với một giấy phép còn hiệu lực sẽ bị gỡ.',
    },
    {
      en: 'No promised outcome. No listing, title, photo or chat message may claim a guaranteed result — "guaranteed visa", "100% approval", "bao đậu" / "bảo đậu", "no refusal" or anything equivalent. Only the Vietnamese immigration authorities decide an application, and nobody on this platform can promise, buy or hurry that decision. Offering to refund the service fee if an application is refused is a different thing and is allowed; claiming the decision itself is certain is not.',
      vi: 'Không hứa hẹn kết quả. Tin đăng, tiêu đề, ảnh hay tin nhắn không được khẳng định kết quả chắc chắn — “bao đậu”, “bảo đậu”, “đậu 100%”, “cam kết có visa”, “không bị từ chối” hoặc bất kỳ cách nói tương tự nào. Chỉ cơ quan quản lý xuất nhập cảnh Việt Nam mới quyết định một hồ sơ, và không ai trên nền tảng này có thể hứa hẹn, mua hoặc đẩy nhanh quyết định đó. Cam kết hoàn phí dịch vụ nếu hồ sơ bị từ chối là một việc khác và được phép; khẳng định chính quyết định đó là chắc chắn thì không.',
    },
    {
      en: 'No pretending to be an official channel. A listing, storefront name, logo or photo may not present itself as a government body, an official e-visa portal, an embassy or a consulate, and may not use a state emblem or an official seal. Claiming to have contacts inside an immigration office, or to be able to reach one, is banned outright.',
      vi: 'Không giả danh kênh chính thức. Tin đăng, tên gian hàng, logo hoặc ảnh không được tự giới thiệu là cơ quan nhà nước, cổng thông tin e-Visa chính thức, đại sứ quán hay lãnh sự quán, và không được dùng quốc huy hoặc con dấu của cơ quan nhà nước. Tuyệt đối cấm việc tự nhận có người quen trong cơ quan quản lý xuất nhập cảnh hoặc có thể tác động tới cơ quan đó.',
    },
    {
      en: 'The government fee must be shown separately. A visa listing must state the official government fee and the service fee charged by the provider as two separate amounts, before anyone pays anything. The government fee is set by the State and is paid for the application itself; it is generally not refundable once an application has been submitted. A listing must not fold it into one unexplained total, present it as the provider’s own charge, or reveal it only at checkout — and it must say what the service fee actually buys.',
      vi: 'Lệ phí nhà nước phải được nêu riêng. Tin đăng dịch vụ thị thực phải nêu lệ phí chính thức của nhà nước và phí dịch vụ của nhà cung cấp thành hai khoản riêng, trước khi bất kỳ ai thanh toán. Lệ phí nhà nước do Nhà nước quy định và được nộp cho chính hồ sơ; thông thường không được hoàn lại sau khi hồ sơ đã nộp. Tin đăng không được gộp lệ phí này vào một tổng số tiền không được giải thích rõ, không được trình bày lệ phí như khoản thu của chính nhà cung cấp và không được chỉ cho biết khi thanh toán — đồng thời phải nêu rõ phí dịch vụ bao gồm những gì.',
    },
    {
      en: 'Nothing that works around the process instead of going through it. Arranging or covering up an overstay other than by paying the official penalty, obtaining a stamp, approval letter or entry record outside the official process, or paying an official to move a file, may not be offered, advertised or hinted at. Forged and altered documents are already banned further up this page; this is the same rule applied to the process itself.',
      vi: 'Không lách quy trình thay vì đi đúng quy trình. Không được chào bán, quảng cáo hay ám chỉ việc thu xếp hoặc che giấu tình trạng ở quá hạn bằng cách nào khác ngoài nộp phạt theo quy định, việc lấy dấu, công văn chấp thuận hoặc dữ liệu nhập cảnh ngoài quy trình chính thức, hay việc chi tiền cho cán bộ để “chạy” hồ sơ. Giấy tờ giả và giấy tờ bị sửa chữa đã bị cấm ở phần trên của trang này; đây là cùng quy định đó, áp dụng cho chính quy trình.',
    },
    {
      en: 'Documents and payment stay on the route the listing describes. A provider may not ask you to send passport scans, portrait photos or personal details through a private channel outside the application flow shown on the listing, and may not ask you to pay by a route the listing does not describe. If someone asks you to do either, report the listing — that request is the most reliable scam signal there is.',
      vi: 'Giấy tờ và thanh toán phải đi đúng cách thức tin đăng mô tả. Nhà cung cấp không được yêu cầu bạn gửi bản chụp hộ chiếu, ảnh chân dung hay thông tin cá nhân qua một kênh riêng nằm ngoài quy trình nộp hồ sơ được nêu trên tin đăng, và không được yêu cầu bạn thanh toán theo cách tin đăng không mô tả. Nếu có người yêu cầu bạn làm một trong hai việc đó, hãy báo cáo tin đăng — đó là dấu hiệu lừa đảo đáng tin cậy nhất.',
    },
  ],
}

const sections = [
  { id: 'illegal', label: 'Illegal — never allowed', labelVi: 'Bị cấm — không được đăng' },
  { id: 'regulated', label: 'Regulated — cannot be sold P2P', labelVi: 'Có điều kiện — không bán giữa cá nhân' },
  { id: 'policy', label: 'Platform policy bans', labelVi: 'Cấm theo chính sách của sàn' },
  { id: 'services', label: 'Banned services', labelVi: 'Dịch vụ bị cấm' },
  { id: 'visa-services', label: 'Visa & immigration rules', labelVi: 'Quy định về thị thực' },
  { id: 'enforcement', label: 'Enforcement', labelVi: 'Xử lý vi phạm' },
]

export default async function ProhibitedPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params
  const vi = lang === 'vi'
  const say = (p: Pair) => (vi ? p.vi : <Tr text={p.en} />)
  return (
    <ContentPage
      title="Prohibited items & services"
      titleVi="Hàng hoá và dịch vụ cấm đăng"
      meta={
        <>
          <p className="mt-3 text-sm text-ink-4">
            <Bilingual en="Part of the Operating Regulations · Last updated: {date}" vi="Một phần của Quy chế hoạt động · Cập nhật lần cuối: {date}" values={{ date: vi ? PROHIBITED_AMENDED.publishedVi : PROHIBITED_AMENDED.publishedEn }} datesIso={{ date: PROHIBITED_AMENDMENT.published }} />
          </p>
          <LegalLanguageNote />
        </>
      }
      intro={say(INTRO)}
      sections={sections}
    >
      {GROUPS.map((g) => (
        <ContentSection key={g.id} id={g.id} title={g.title} titleVi={g.titleVi}>
          <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-body">
            {g.items.map((it) => (
              <li key={it.en}>{say(it)}</li>
            ))}
          </ul>
        </ContentSection>
      ))}
      <ContentSection id="visa-services" title={VISA_RULES.title} titleVi={VISA_RULES.titleVi}>
        {/* eno.vn only: the rules apply there from PROHIBITED_AMENDMENT.inForce (eno.forum has had them since
            August). Typed dates, so the sentence stays true before and after that day on this static prerender.
            Immediate (owner, 2026-10-15: "apply from now"): one date — published and in force the same day. */}
        {IS_MARKETPLACE && (
          <p className="text-sm leading-relaxed text-body">
            {PROHIBITED_AMENDMENT.immediate ? (
              <Bilingual
                en="These rules were published on {published} and apply on {site} from that day, including to listings posted before it."
                vi="Các quy định này được công bố ngày {published} và áp dụng trên {site} từ ngày đó, kể cả đối với tin đã đăng trước đó."
                values={{ site: SITE_NAME, published: vi ? PROHIBITED_AMENDED.publishedVi : PROHIBITED_AMENDED.publishedEn }}
                datesIso={{ published: PROHIBITED_AMENDMENT.published }}
              />
            ) : (
              <Bilingual
                en="These rules were published on {published} and apply on {site} from {inForce}, including to listings posted before that date."
                vi="Các quy định này được công bố ngày {published} và áp dụng trên {site} từ ngày {inForce}, kể cả đối với tin đã đăng trước ngày đó."
                values={{ site: SITE_NAME, published: vi ? PROHIBITED_AMENDED.publishedVi : PROHIBITED_AMENDED.publishedEn, inForce: vi ? PROHIBITED_AMENDED.inForceVi : PROHIBITED_AMENDED.inForceEn }}
                datesIso={{ published: PROHIBITED_AMENDMENT.published, inForce: PROHIBITED_AMENDMENT.inForce }}
              />
            )}
          </p>
        )}
        <p className="text-sm leading-relaxed text-body">{say(VISA_RULES.intro)}</p>
        <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-body">
          {VISA_RULES.items.map((it) => (
            <li key={it.en}>{say(it)}</li>
          ))}
        </ul>
      </ContentSection>
      <ContentSection id="enforcement" title="Enforcement" titleVi="Xử lý vi phạm">
        <p className="text-sm leading-relaxed text-body">{say(ENFORCEMENT)}</p>
        {IS_SERVICES && !!PROHIBITED_SERVICES_CROSSLINK.href && (
          <p className="text-sm leading-relaxed text-body">
            {vi ? PROHIBITED_SERVICES_CROSSLINK.leadVi : <Tr text={PROHIBITED_SERVICES_CROSSLINK.lead} />}{' '}
            <a href={PROHIBITED_SERVICES_CROSSLINK.href} rel={CROSS_SITE_REL} className="font-semibold text-accent-foreground hover:underline">
              {PROHIBITED_SERVICES_CROSSLINK.label}
            </a>
            {'.'}
          </p>
        )}
      </ContentSection>
    </ContentPage>
  )
}
