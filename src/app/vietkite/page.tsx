import type { Metadata } from 'next'
import Image from 'next/image'
import { Tr } from '@/context/language-context'
import { ContentPage, ContentSection } from '@/components/marketplace/content-page'
import { Bilingual } from '@/components/marketplace/bilingual'
import { VIETKITE, VIETKITE_LOGO, VIETKITE_HAS_CONTACT } from '@/lib/vietkite'

/**
 * VIETKITE — the partner company page, and the destination for the e-visa banner on the home page.
 *
 * ⚠️ WHY THIS PAGE IS ALLOWED TO EXIST ON eno.vn, since the edition rule says otherwise.
 * The standing rule is that eno.vn — the licensed sàn TMĐT — must not mention visa services at all,
 * because a licensed operator advertising an unlicensed service is a legal problem rather than a
 * UX one. The owner lifted that for this partner on 2026-08-10, on the basis that eno.forum is not
 * operational, that eno.vn's own licences are in progress, and that VietKite's licences were
 * checked and are "in par what government demands". That is an owner decision about their own
 * regulatory position, recorded here so the next person does not "fix" this page away as a leak.
 *
 * ⚠️ WHAT HAS NOT CHANGED, AND MUST NOT. eno introduces VietKite; it does not perform, guarantee or
 * take payment for the service. Every existing stub still stands — visa-provider, privacy, terms
 * and prohibited copy are still aliased to empty on a marketplace build, and their guards in
 * edition-stubs.test.ts still pass. This page adds ONE sanctioned surface; it does not open the
 * floodgates, and PayPal/itinerary vocabulary is still forbidden everywhere.
 *
 * ⚠️ THE COMPANY FACTS ARE INCOMPLETE ON PURPOSE. Phone, email, address and the registration and
 * licence numbers are being supplied by the owner separately. Each is '' in src/lib/vietkite.ts
 * until then, and every row below is conditional on its value — an absent fact renders NOTHING
 * rather than an empty label. Do not fill them with plausible placeholders: a fake phone number on
 * a company page reads as answered, which is worse than visibly missing.
 */
export const metadata: Metadata = {
  title: 'VietKite — Travel & Visa partner',
  description:
    'VietKite (Công ty TNHH Cánh Diều Việt) is the licensed travel and visa company eno works with for Vietnam e-visa services.',
  alternates: { canonical: '/vietkite' },
}

/** One fact row. Renders nothing at all when the value has not been supplied yet. */
function Fact({ label, labelVi, value, href }: { label: string; labelVi: string; value: string; href?: string }) {
  if (!value) return null
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="shrink-0 text-sm font-semibold text-body sm:w-48">
        <Bilingual en={label} vi={labelVi} />
      </dt>
      <dd className="text-sm text-foreground">
        {href ? (
          // Outbound and user-facing: noopener/noreferrer, never target-blank without them.
          <a href={href} className="underline decoration-1 underline-offset-2 hover:text-accent-foreground" rel="noopener noreferrer">
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
  )
}

export default function VietKitePage() {
  return (
    <ContentPage
      title="VietKite"
      meta={<Bilingual en="Travel & Visa partner" vi="Đối tác du lịch & thị thực" />}
      intro={
        <Bilingual
          en="VietKite is a licensed Vietnamese travel and visa company. eno introduces them; they handle the service under their own licence."
          vi="VietKite là công ty du lịch và thị thực được cấp phép tại Việt Nam. eno giới thiệu; VietKite thực hiện dịch vụ theo giấy phép của họ."
        />
      }
    >
      <ContentSection wide>
        {/* The mark is the fastest identity check a visitor can make — it is the same logo on the
            banner that brought them here, so the handover reads as one company rather than two.
            Sized, not intrinsic: the source is 500×500 with transparency. */}
        <Image
          src={VIETKITE_LOGO}
          alt="VietKite — Công ty TNHH Cánh Diều Việt"
          width={160}
          height={160}
          className="h-32 w-32 object-contain sm:h-40 sm:w-40"
          priority={false}
        />
      </ContentSection>

      <ContentSection title="Who they are">
        <p className="text-sm leading-relaxed text-body">
          <Bilingual
            en={`${VIETKITE.name} is the trading name of ${VIETKITE.legalName}, a travel and visa company registered in Vietnam.`}
            vi={`${VIETKITE.name} là tên giao dịch của ${VIETKITE.legalName}, công ty du lịch và thị thực đăng ký tại Việt Nam.`}
          />
        </p>
        <p className="text-sm leading-relaxed text-body">
          {/* ⚠️ The one sentence that keeps this page accurate: eno is not the provider. Do not
              soften it into "we offer visas" — that claim belongs to the licence holder. */}
          <Bilingual
            en="Applications are submitted, handled and delivered by VietKite under its own licence. eno is not the provider and does not guarantee the outcome of any application."
            vi="Hồ sơ do VietKite tiếp nhận, xử lý và bàn giao theo giấy phép của VietKite. eno không phải đơn vị cung cấp và không bảo đảm kết quả của bất kỳ hồ sơ nào."
          />
        </p>
      </ContentSection>

      {VIETKITE_HAS_CONTACT && (
        <ContentSection title="Contact">
          <dl className="space-y-3">
            <Fact label="Phone" labelVi="Điện thoại" value={VIETKITE.phone} href={VIETKITE.phone ? `tel:${VIETKITE.phone.replace(/\s+/g, '')}` : undefined} />
            <Fact label="Email" labelVi="Email" value={VIETKITE.email} href={VIETKITE.email ? `mailto:${VIETKITE.email}` : undefined} />
            <Fact label="Address" labelVi="Địa chỉ" value={VIETKITE.address} />
            <Fact label="Website" labelVi="Website" value={VIETKITE.website} href={VIETKITE.website || undefined} />
          </dl>
        </ContentSection>
      )}

      {(VIETKITE.registrationNo || VIETKITE.licenceNo) && (
        <ContentSection title="Registration">
          <dl className="space-y-3">
            <Fact label="Enterprise registration no." labelVi="Mã số doanh nghiệp" value={VIETKITE.registrationNo} />
            <Fact label="Travel service licence no." labelVi="Số giấy phép lữ hành" value={VIETKITE.licenceNo} />
          </dl>
          <p className="text-xs leading-relaxed text-muted-foreground">
            <Tr text="These numbers are published so they can be checked against the national business registry." />
          </p>
        </ContentSection>
      )}

      {!VIETKITE_HAS_CONTACT && (
        <ContentSection title="Contact">
          {/* Honest empty state rather than a hidden section: a company page with no way to reach
              the company should say so, not quietly omit it. Disappears the moment a real value
              lands in src/lib/vietkite.ts. */}
          <p className="text-sm leading-relaxed text-muted-foreground">
            <Tr text="Contact details are being added." />
          </p>
        </ContentSection>
      )}
    </ContentPage>
  )
}
