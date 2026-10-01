import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import { withShare } from '@/lib/site-identity'
import { Tr } from '@/context/language-context'
import { ContentPage, ContentSection } from '@/components/marketplace/content-page'
import { PartnerBadge } from '@/components/marketplace/partner-badge'
import { Bilingual } from '@/components/marketplace/bilingual'

export const metadata: Metadata = withShare({
  title: `Official partners — ${SITE_NAME}`,
  description:
    'What the Official partner badge means on eno: a company that has signed an agreement with eno. Every other shop whose catalogue appears here is a Linked shop — what that means for buyers, and how commissions are disclosed.',
  alternates: { canonical: '/partners' },
})

/**
 * THE EXPLAINER BEHIND THE PARTNER BADGE — the /trust of partnerships, and built the same
 * way (ContentPage + ContentSection, flat canvas, hairline rows, no panels).
 *
 * ⛔ OWNER DECISION 2026-10-01: THE BADGE MEANS A SIGNED AGREEMENT, AND NOTHING ELSE. On 2026-09-17
 * the badge had been granted to every shop whose catalogue eno imports (Tiki, CellphoneS, FPT Shop,
 * the eSIM carriers, VinWonders…), none of which signed anything — so this page's "eno chose this
 * company deliberately, verified its licences and agreed terms with it" was false of most badge
 * holders. The badge is now kept only for companies with a signed agreement (the DB flip is
 * scripts/set-official-partner.mjs, run separately); every other imported storefront shows a neutral
 * "Linked shop" chip, which this page also explains.
 *
 * ⛔ SHIPS ONLY WITH: the DB flip, importers that stop creating badged storefronts (import-partners,
 * import-accesstrade, import-supersports, seed-vinwonders, set-import-partners, set-partner-avatar
 * --official all write officialPartner:true today), and W-C's "Linked shop" chip, "Ad" marker and
 * commission note — the `what` and `linked` sections state them as facts. The badge's own tooltip
 * (partner-badge.tsx, rendered right here) still says "eno carries this shop's catalogue" and must
 * change with them.
 *
 * ⚠️ THE PAGE LISTS NO PARTNER BY NAME, AND THAT IS DELIBERATE. It is not data-driven and it renders on
 * BOTH editions: one signed partner is the services edition's visa provider, which eno.vn may not even
 * mention (src/lib/edition.ts). Each partner's storefront carries the badge itself.
 *
 * ⚠️ "IT IS NOT ADVERTISING AND IT CANNOT BE BOUGHT" WAS REMOVED. A partner agreement can pay eno a
 * commission (the services edition's provider does — src/lib/terms-services-copy.ts), so the badge is
 * a disclosed business relationship, not an independent rating — the page now says exactly that.
 *
 * ⚠️ THE COPY NAMES THE BADGE BY ITS SHAPE, NEVER BY A COLOUR. It said "a gold Partner badge" for
 * two weeks after the plate turned partner green (partner-badge.tsx, 2026-09-14), and the dark theme
 * still inverts it — any colour word here is a claim one theme contradicts (C-PARTNERS-COPY).
 *
 * ⚠️ THE ONE SENTENCE THIS PAGE MUST NOT CONTAIN: that eno "guarantee[s] the quality of service". eno.vn
 * is a licensed sàn TMĐT — an intermediary — and a marketplace that publicly guarantees a third
 * party's service has, in one sentence, assumed the liability of the seller for a service it is not
 * licensed to perform.
 *
 * ⚠️ COPY IS AUTHORED IN BOTH LANGUAGES (<Bilingual>), so a Vietnamese reader's server HTML carries the
 * curated Vietnamese rather than a machine translation; the nine other languages translate the English.
 */
/** One "what eno asks for" row. Nodes, not strings, so every literal stays in the JSX below. */
function Check({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="py-3">
      <div className="text-sm font-medium text-foreground">{title}</div>
      <div className="mt-0.5 text-sm leading-relaxed text-ink-4">{children}</div>
    </div>
  )
}

export default function PartnersPage() {
  return (
    <ContentPage
      title="Official partners"
      titleVi="Đối tác chính thức"
      /* ⛔ PHRASING CONTENT ONLY. ContentPage renders `intro` INSIDE a <p>; a block element here closed the
         outer <p> early and broke hydration (React #418, C-HYDRATION, 2026-09-29).
         src/app/[lang]/html-nesting-contract.test.ts fails the build on a block element here. */
      intro={
        <Bilingual
          en="The Official partner badge — a shield — marks a company that has signed an agreement with eno. Every other shop whose catalogue appears on eno is a Linked shop. This page explains both, and what each means for you as a buyer."
          vi="Huy hiệu Đối tác chính thức — hình chiếc khiên — dành cho công ty đã ký thoả thuận hợp tác với eno. Mọi cửa hàng khác có danh mục sản phẩm xuất hiện trên eno là Cửa hàng liên kết. Trang này giải thích cả hai, và ý nghĩa của từng loại đối với bạn khi mua hàng."
        />
      }
      sections={[
        { id: 'what', label: 'What the badge means', labelVi: 'Ý nghĩa của huy hiệu' },
        { id: 'linked', label: 'Linked shops', labelVi: 'Cửa hàng liên kết' },
        { id: 'checks', label: 'What eno asks for', labelVi: 'eno yêu cầu những gì' },
        { id: 'keeps', label: 'Keeping the badge', labelVi: 'Duy trì huy hiệu' },
        { id: 'position', label: "eno's position", labelVi: 'Vai trò của eno' },
      ]}
    >
      <ContentSection id="what" title="What the badge means" titleVi="Ý nghĩa của huy hiệu">
        <div className="flex items-center gap-2">
          <PartnerBadge size="md" />
          <span className="text-sm text-ink-4"><Tr text="on a storefront, a listing, or a chat header" /></span>
        </div>
        <p className="leading-relaxed">
          <Bilingual
            en="It means the company has signed a cooperation agreement with eno. Any business can sell on eno; only a company with a signed agreement carries this badge."
            vi="Huy hiệu cho biết công ty đó đã ký thoả thuận hợp tác với eno. Doanh nghiệp nào cũng có thể bán hàng trên eno; chỉ công ty đã ký thoả thuận mới mang huy hiệu này."
          />
        </p>
        {/* No seller-facing route reaches the column (schema.prisma's note on Seller.officialPartner), so
            "no seller can give it to itself" is a code fact. ⛔ NOT "granted by a person, never by an
            algorithm": several import scripts set it in bulk — see the header. */}
        <p className="leading-relaxed">
          <Bilingual
            en="The badge is granted and withdrawn by eno, and no seller can give it to itself. It is not a trust score and it is not earned by good behaviour alone: it records a business relationship."
            vi="Huy hiệu do eno cấp và thu hồi, và không người bán nào tự gán được cho mình. Đây không phải điểm uy tín và không thể có được chỉ nhờ hoạt động tốt: huy hiệu ghi nhận một quan hệ hợp tác kinh doanh."
          />
        </p>
      </ContentSection>

      <ContentSection id="linked" title="Linked shops" titleVi="Cửa hàng liên kết">
        <p className="leading-relaxed">
          <Bilingual
            en="Many listings on eno come from shops whose online catalogues we show here — electronics retailers, mobile carriers selling eSIMs, attraction tickets and more. These shops have not signed an agreement with eno, so they do not carry the partner badge: their storefronts are marked Linked shop."
            vi="Nhiều tin trên eno đến từ các cửa hàng có danh mục sản phẩm trực tuyến được chúng tôi hiển thị tại đây — cửa hàng điện máy, nhà mạng bán eSIM, vé tham quan và nhiều loại khác. Các cửa hàng này chưa ký thoả thuận với eno nên không mang huy hiệu đối tác: gian hàng của họ được gắn nhãn Cửa hàng liên kết."
          />
        </p>
        {/* "Takes you to the shop's website", never "opens the product": SuperSports' links land on the
            shop (scripts/import-supersports.ts, mintLinks) and some affiliate campaigns need a second
            step to reach the product (AffiliateProductStep, affiliate-booking.tsx). */}
        <p className="leading-relaxed">
          <Bilingual
            en="Their listings are linked listings. Each names the shop and its button takes you to the shop's own website, where you buy under the shop's own price, terms and returns policy. eno has not vetted these shops and takes no payment for what you buy there."
            vi="Tin của họ là tin đăng liên kết. Mỗi tin ghi rõ tên cửa hàng, và nút trên tin đưa bạn sang chính website của cửa hàng, nơi bạn mua theo giá, điều kiện và chính sách đổi trả của cửa hàng đó. eno chưa thẩm định các cửa hàng này và không nhận thanh toán cho những gì bạn mua tại đó."
          />
        </p>
        <p className="leading-relaxed">
          <Bilingual
            en="We may earn a commission when you buy through some of these links. Those links are labelled Ad, with a note saying so. You do not pay the commission, and it does not change your price."
            vi="Chúng tôi có thể nhận hoa hồng khi bạn mua hàng qua một số đường dẫn này. Các đường dẫn đó được gắn nhãn Quảng cáo kèm ghi chú về việc này. Bạn không phải trả khoản hoa hồng đó, và nó không làm thay đổi giá bạn trả."
          />
        </p>
      </ContentSection>

      <ContentSection id="checks" title="What eno asks for before signing" titleVi="eno yêu cầu những gì trước khi ký">
        {/* Written out rather than mapped over a tuple array, so every literal stays visible here. */}
        <div className="divide-y divide-border">
          <Check title={<Bilingual en="Business registration" vi="Đăng ký doanh nghiệp" />}>
            <Bilingual
              en="The company is a registered entity, and the name on the storefront is the name on the paperwork."
              vi="Công ty là pháp nhân đã đăng ký, và tên trên gian hàng trùng với tên trên giấy tờ."
            />
          </Check>
          <Check title={<Bilingual en="Sector licences" vi="Giấy phép ngành nghề" />}>
            <Bilingual
              en="Whatever that line of business legally requires to operate in Vietnam, for that specific company."
              vi="Những giấy phép mà ngành nghề đó bắt buộc phải có để hoạt động tại Việt Nam, của chính công ty đó."
            />
          </Check>
          <Check title={<Bilingual en="Who is responsible" vi="Ai chịu trách nhiệm" />}>
            <Bilingual
              en="A named contact at the company that eno can reach directly, so a problem has somewhere to go."
              vi="Một đầu mối có tên tuổi tại công ty mà eno liên hệ trực tiếp được, để mọi vấn đề đều có nơi tiếp nhận."
            />
          </Check>
          <Check title={<Bilingual en="What is actually delivered" vi="Những gì thực sự được cung cấp" />}>
            <Bilingual
              en="What the service includes, what it costs, and how long it takes — so the offer on eno matches the offer the buyer receives."
              vi="Dịch vụ gồm những gì, giá bao nhiêu và mất bao lâu — để những gì chào bán trên eno đúng với những gì người mua nhận được."
            />
          </Check>
        </div>
      </ContentSection>

      <ContentSection id="keeps" title="Keeping the badge" titleVi="Duy trì huy hiệu">
        <p className="leading-relaxed">
          <Bilingual
            en="The badge lasts only as long as the agreement, and eno can withdraw it at any time — including from a company whose service slips."
            vi="Huy hiệu chỉ tồn tại khi thoả thuận còn hiệu lực, và eno có thể thu hồi bất cứ lúc nào — kể cả với công ty có chất lượng dịch vụ đi xuống."
          />
        </p>
        {/* phoneForSeller() returns null for an official partner (src/lib/contact.ts). */}
        <p className="leading-relaxed">
          <Bilingual
            en="Partners answer in eno's own chat rather than sending buyers off-platform: there is no phone number to reveal on a partner storefront, so every conversation stays where a dispute can be opened and read later."
            vi="Đối tác trả lời ngay trong khung chat của eno thay vì kéo người mua ra ngoài nền tảng: gian hàng đối tác không có số điện thoại để hiển thị, nên mọi cuộc trò chuyện đều ở lại nơi có thể mở và xem xét tranh chấp về sau."
          />
        </p>
      </ContentSection>

      <ContentSection id="position" title="eno's position, stated plainly" titleVi="Nói rõ về vai trò của eno">
        <p className="leading-relaxed">
          <Bilingual
            en="eno is the marketplace, not the provider. A partner performs its service under its own licence and the contract for it is between the buyer and the partner — exactly as with any other seller, and each partner storefront says so."
            vi="eno là sàn giao dịch, không phải bên cung cấp. Đối tác thực hiện dịch vụ theo giấy phép của chính mình và hợp đồng dịch vụ là giữa người mua với đối tác — giống hệt như với mọi người bán khác, và mỗi gian hàng đối tác đều ghi rõ điều này."
          />
        </p>
        <p className="leading-relaxed">
          <Bilingual
            en="A partner agreement may include a commission paid to eno, so the badge discloses a business relationship — it is not an independent rating and not a guarantee. If something goes wrong with a partner, open a dispute in the chat: eno reads it and follows it up with a company it has a signed agreement with."
            vi="Thoả thuận đối tác có thể bao gồm khoản hoa hồng trả cho eno, vì vậy huy hiệu là việc công khai một quan hệ kinh doanh — không phải đánh giá độc lập và cũng không phải sự bảo đảm. Nếu có vấn đề với một đối tác, hãy mở tranh chấp ngay trong khung chat: eno sẽ xem xét và làm việc tiếp với công ty mà eno đã ký thoả thuận."
          />
        </p>
      </ContentSection>
    </ContentPage>
  )
}
