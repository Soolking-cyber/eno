import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import { IS_SERVICES } from '@/lib/edition'
import { Tr } from '@/context/language-context'
import { ContentPage, ContentSection } from '@/components/marketplace/content-page'
import { COMPANY } from '@/lib/site-legal'

export const metadata: Metadata = {
  title: `Quy chế hoạt động | Operating Regulations | ${SITE_NAME}`,
  description: 'Operating regulations of the eno.vn e-commerce platform (Quy chế hoạt động sàn giao dịch thương mại điện tử eno.vn).',
  alternates: { canonical: '/regulations' },
}

// ── Quy chế hoạt động sàn GDTMĐT (Decree 52/2013 Điều 38, E-commerce Law 122/2025) ──
// The nine legally mandatory contents, published on the site and linked from the
// homepage footer. EN-authoritative like every text page (VI via the translation
// layer) — give the VI a curated legal pass before filing the MoIT dossier.
// Changes must be announced to users at least 5 days before taking effect (Đ.38.3).

const sections = [
  { id: 'general', label: 'General principles' },
  { id: 'operator', label: 'Platform operator' },
  { id: 'process', label: 'How transactions work' },
  { id: 'rights-operator', label: 'Our rights & duties' },
  { id: 'rights-users', label: 'Your rights & duties' },
  { id: 'sellers', label: 'Seller information & verification' },
  { id: 'fees', label: 'Fees & payment' },
  { id: 'privacy', label: 'Personal information' },
  { id: 'complaints', label: 'Complaints & disputes' },
  { id: 'prohibited', label: 'Prohibited goods, IP & sanctions' },
  { id: 'ranking', label: 'How listings are ranked' },
  { id: 'amendments', label: 'Amendments' },
]

export default function RegulationsPage() {
  return (
    <ContentPage
      eyebrow="Legal"
      title="Operating Regulations (Quy chế hoạt động)"
      meta={<p className="mt-2 text-xs text-ink-4"><Tr text="Last updated: July 2026 · Changes are announced to users at least 5 days before taking effect." /></p>}
      intro={<Tr text="These regulations govern how the eno.vn e-commerce platform operates, per Vietnamese e-commerce law (Decree 52/2013/ND-CP as amended, and the Law on E-commerce 122/2025/QH15). eno.vn is a classifieds marketplace: sellers and buyers deal with each other directly; eno.vn is not a party to any transaction and processes no payments between buyers and sellers." />}
      sections={sections}
    >
      <ContentSection id="general" title="1. General principles">
        <p className="text-sm leading-relaxed text-body"><Tr text="eno.vn is an intermediary e-commerce platform (san giao dich thuong mai dien tu) where individuals and organizations post listings to sell or rent goods and services. All users must be at least 18 years old, comply with Vietnamese law and these regulations, and are responsible for the content they post. Transactions are agreed and completed directly between buyer and seller — in person, at their own arrangement." /></p>
      </ContentSection>

      <ContentSection id="operator" title="2. Platform operator">
        <p className="text-sm leading-relaxed text-body">
          {COMPANY.name} · <Tr text="Head office" />: {COMPANY.address} · <Tr text="Business registration no." /> {COMPANY.erc} (<Tr text="issued" /> {COMPANY.ercIssued}) · Email: {COMPANY.email} · <Tr text="Phone" />: {COMPANY.phone}.
        </p>
        <p className="text-sm leading-relaxed text-body"><Tr text="This is the contact point designated for users and for competent state authorities (market surveillance, tax, public security). Requests from authorities to remove violating content are actioned within 24 hours." /></p>
      </ContentSection>

      <ContentSection id="process" title="3. How transactions work on eno.vn">
        <p className="text-sm leading-relaxed text-body"><Tr text="1) A seller creates an account (phone or email verified), posts a listing with photos, description and a price in Vietnamese dong (VND, tax inclusive). 2) The listing goes live after automated checks (prohibited-goods filter, photo requirement, contact-in-text scan). 3) A buyer finds the listing via search or browsing and contacts the seller through the on-platform chat (or makes an offer). 4) Buyer and seller agree terms and complete the exchange directly — typically meeting in person. eno.vn provides no ordering, delivery or payment function for these transactions and holds no buyer-or-seller money at any point." /></p>
      </ContentSection>

      <ContentSection id="rights-operator" title="4. Rights and responsibilities of eno.vn">
        <p className="text-sm leading-relaxed text-body"><Tr text="eno.vn maintains the platform's stable and secure operation; verifies seller information as required by law; removes listings that violate law or these regulations (and removes content within 24 hours of a lawful request by a competent authority); operates the complaint and report system described in section 9; protects users' personal data per the Privacy Policy; stores transaction-related records as required by law (minimum 3 years); and reports statistics and seller information to state authorities where the law requires (including periodic seller-information reports to the tax authority)." /></p>
        <p className="text-sm leading-relaxed text-body"><Tr text="eno.vn may warn, restrict, suspend or permanently remove accounts and listings that violate law or these regulations, applying the graduated enforcement ladder described on the trust page. eno.vn is not liable for the quality, legality or delivery of items sold by users, but will cooperate in good faith to resolve complaints and will act on violations it knows of." /></p>
      </ContentSection>

      <ContentSection id="rights-users" title="5. Rights and responsibilities of users">
        <p className="text-sm leading-relaxed text-body"><Tr text="Buyers may browse free of charge, contact sellers, leave reviews after a completed transaction, and report listings, sellers or conversations. Sellers must post truthful information with real photos, list prices in VND (tax inclusive) and honour them, hold whatever licenses or documents the law requires for what they sell, keep their account contact information accurate, and answer buyers honestly. All users must not post prohibited items (section 10), must not attempt to move contact off-platform in listing text, must not manipulate reviews or trust scores, and must not use the platform for fraud of any kind." /></p>
      </ContentSection>

      <ContentSection id="sellers" title="6. Seller information & verification">
        <p className="text-sm leading-relaxed text-body"><Tr text="Sellers register with a verified phone number or email. As required by e-commerce law, eno.vn collects and will progressively verify seller identification: full name, address, citizen ID number (CCCD) or business registration number, tax code where applicable, phone and email. Business sellers display their business name on their storefront. Identity verification via Vietnam's electronic identification system (VNeID) will be introduced per the Law on E-commerce 122/2025. Seller information is provided to buyers on request and to competent authorities as required by law." /></p>
      </ContentSection>

      <ContentSection id="fees" title="7. Fees & payment">
        {/* ⚠️ FORKED BY EDITION, AND THE MARKETPLACE BRANCH MUST NOT MENTION e-VISA OR A PAYMENT
            PROVIDER. This is the MoIT sàn-TMĐT disclosure, so the page stays live on both editions —
            404 is not an option here. But the original sentence had the licensed operator stating,
            in its own compliance text, that it sells assisted e-Visa applications and takes card
            payment for them. That is the single most quotable line on the site for a regulator
            checking whether eno.vn offers a service it is not licensed for.

            ⚠️ TWO STRING LITERALS, NOT ONE STRING BUILT BY CONCATENATION. scripts/gen-ui-strings.mjs
            harvests `<Tr text="…">` by static analysis, so a composed string would silently drop out
            of the translation catalogue and the CI drift guard would not notice. */}
        {IS_SERVICES ? (
          <p className="text-sm leading-relaxed text-body"><Tr text="Posting and browsing on eno.vn are currently free. eno.vn processes no payments between buyers and sellers and holds no escrow. If paid services for sellers (for example subscriptions or promoted listings) are introduced, they will be announced at least 5 days in advance with clear pricing in VND, and paid placement will always be visibly labeled. Separately, optional assistance services offered by eno itself (for example the assisted e-Visa application service) may carry a clearly displayed service fee, paid to eno in advance through our payment providers (such as Stripe or PayPal); such fees are for eno's own service and are never a payment between buyers and sellers." /></p>
        ) : (
          <p className="text-sm leading-relaxed text-body"><Tr text="Posting and browsing on eno.vn are currently free. eno.vn processes no payments between buyers and sellers and holds no escrow. If paid services for sellers (for example subscriptions or promoted listings) are introduced, they will be announced at least 5 days in advance with clear pricing in VND, and paid placement will always be visibly labeled." /></p>
        )}
      </ContentSection>

      <ContentSection id="privacy" title="8. Personal information">
        <p className="text-sm leading-relaxed text-body"><Tr text="Personal data is processed per the Privacy Policy (published at /privacy), which forms part of these regulations, in accordance with the Personal Data Protection Law 91/2025/QH15. Requests concerning personal data can be sent to the operator's email above and are acknowledged within 2 working days." /></p>
      </ContentSection>

      <ContentSection id="complaints" title="9. Complaints & dispute resolution">
        <p className="text-sm leading-relaxed text-body"><Tr text="Any user can report a listing, a seller or a conversation using the Report buttons across the site, or by emailing the operator. Reports are acknowledged within 3 working days. The moderation team reviews evidence from both sides (reporters can supplement their report; affected sellers can appeal once with proof), resolves the report as confirmed or dismissed, and applies the published trust penalties for confirmed violations. Consumer complaints about a seller are handled through the same channel; where negotiation between the parties is appropriate, eno.vn forwards the complaint to the seller, who should respond within 7 working days." /></p>
        <p className="text-sm leading-relaxed text-body"><Tr text="Disputes between buyer and seller are primarily resolved between the parties; eno.vn provides chat records to the parties and to competent authorities as the law allows, and encourages amicable settlement. Unresolved disputes may be brought to consumer-protection organizations, mediation, or the competent Vietnamese courts. These regulations are governed by the law of Vietnam." /></p>
      </ContentSection>

      <ContentSection id="prohibited" title="10. Prohibited goods, intellectual property & sanctions">
        <p className="text-sm leading-relaxed text-body"><Tr text="The full list of goods and services that must not be listed is published at /prohibited and forms part of these regulations. It covers everything Vietnamese law bans from trading or advertising (weapons, drugs, medicines, alcohol, tobacco and e-cigarettes, wildlife, counterfeits, personal data, and more) plus platform policy bans. Listings are screened automatically at posting and removed reactively on reports." /></p>
        <p className="text-sm leading-relaxed text-body"><Tr text="Intellectual property: rights holders can report infringing listings via the report system or the operator email with evidence of ownership; substantiated reports lead to removal and trust penalties, and repeat infringers are removed. Sanctions ladder: warning, listing removal, trust-score penalty, account restriction, suspension, permanent ban — proportionate to severity and repetition, as published on the trust page." /></p>
      </ContentSection>

      <ContentSection id="ranking" title="11. How listings are ranked">
        <p className="text-sm leading-relaxed text-body"><Tr text="Default browse ordering blends three public criteria: the seller's trust score (largest weight), listing demand (views and buyer contacts), and recency (newer first). Search results additionally weigh how well a listing matches the query. No seller can currently pay for a higher position; if promoted placement is ever introduced, it will be clearly labeled as such. The trust-score methodology is published in full on the trust page." /></p>
      </ContentSection>

      <ContentSection id="amendments" title="12. Amendments">
        <p className="text-sm leading-relaxed text-body"><Tr text="eno.vn may amend these regulations to reflect legal or product changes. Amendments are announced on the platform at least 5 days before taking effect. Continued use of the platform after the effective date constitutes acceptance; users who disagree should stop using the service and may request account deletion." /></p>
      </ContentSection>
    </ContentPage>
  )
}
