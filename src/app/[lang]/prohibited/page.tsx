import { IS_SERVICES, SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import { withShare } from '@/lib/site-identity'
import { Tr } from '@/context/language-context'
import { ContentPage, ContentSection } from '@/components/marketplace/content-page'
import { Bilingual } from '@/components/marketplace/bilingual'
import { LegalLanguageNote } from '@/components/legal/legal-language-note'
// ⚠️ "LAST UPDATED" IS THE OCTOBER 2026 AMENDMENT'S DATE (01/10/2026) — a literal in legal-archive.ts
// (V1_SUPERSEDED) since LEGAL_AMENDMENT moved on to the Terms' version 3 (2026-10-07), which did not change
// this list. Never point it back at LEGAL_AMENDMENT: a Terms-only amendment would re-date it.
import { V1_SUPERSEDED, V1_SUPERSEDED_BY } from '@/lib/compliance/legal-archive'
import { CROSS_SITE_REL } from '@/lib/cross-site-links'
import { PROHIBITED_SERVICES_CROSSLINK, PROHIBITED_SERVICES_SECTION } from '@/lib/prohibited-services-copy'

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
// SITE_NAME rather than saying "eno.vn". The services-only visa addendum lives in
// @/lib/prohibited-services-copy, aliased to an empty stub on a marketplace build: the IS_SERVICES
// gate stops it RENDERING, the alias stops the vocabulary reaching eno.vn's artifact, and both are
// required (src/lib/edition.ts has the measurement).
//
// ⚠️ CURATED VIETNAMESE, RENDERED ON THE SERVER (2026-10-01). Every shared string is an {en, vi} pair:
// the `vi` variant prints the curated text into the server HTML, `en` and the nine machine-translated
// languages keep `<Tr text={en}>`. Those `<Tr>` calls take a VARIABLE, so scripts/gen-ui-strings.mjs
// still harvests none of this copy (it only sees literals) — which is also what keeps the services
// addendum out of the shared catalogue: do not "fix" that by inlining the visa strings as literals.
// The addendum itself stays English-only (its aliased module carries no Vietnamese).

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

// Both the section and its rail entry hang off this one boolean. The `items.length` half is not
// belt-and-braces theatre: on a marketplace build the module resolves to the stub, so without it the
// rail would render an anchor to `#` above an empty, untitled section.
const HAS_SERVICES_ADDENDUM = IS_SERVICES && PROHIBITED_SERVICES_SECTION.items.length > 0

const sections = [
  { id: 'illegal', label: 'Illegal — never allowed', labelVi: 'Bị cấm — không được đăng' },
  { id: 'regulated', label: 'Regulated — cannot be sold P2P', labelVi: 'Có điều kiện — không bán giữa cá nhân' },
  { id: 'policy', label: 'Platform policy bans', labelVi: 'Cấm theo chính sách của sàn' },
  { id: 'services', label: 'Banned services', labelVi: 'Dịch vụ bị cấm' },
  ...(HAS_SERVICES_ADDENDUM ? [{ id: PROHIBITED_SERVICES_SECTION.id, label: PROHIBITED_SERVICES_SECTION.label }] : []),
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
            <Bilingual en="Part of the Operating Regulations · Last updated: {date}" vi="Một phần của Quy chế hoạt động · Cập nhật lần cuối: {date}" values={{ date: vi ? V1_SUPERSEDED.publishedVi : V1_SUPERSEDED.publishedEn }} datesIso={{ date: V1_SUPERSEDED_BY.published }} />
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
      {HAS_SERVICES_ADDENDUM && (
        <ContentSection id={PROHIBITED_SERVICES_SECTION.id} title={PROHIBITED_SERVICES_SECTION.title}>
          <p className="text-sm leading-relaxed text-body"><Tr text={PROHIBITED_SERVICES_SECTION.intro} /></p>
          <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-body">
            {PROHIBITED_SERVICES_SECTION.items.map((it) => (
              <li key={it}><Tr text={it} /></li>
            ))}
          </ul>
        </ContentSection>
      )}
      <ContentSection id="enforcement" title="Enforcement" titleVi="Xử lý vi phạm">
        <p className="text-sm leading-relaxed text-body">{say(ENFORCEMENT)}</p>
        {IS_SERVICES && !!PROHIBITED_SERVICES_CROSSLINK.href && (
          <p className="text-sm leading-relaxed text-body">
            <Tr text={PROHIBITED_SERVICES_CROSSLINK.lead} />{' '}
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
