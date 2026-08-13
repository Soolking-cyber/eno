import { SITE_NAME } from '@/lib/edition'
import type { Metadata } from 'next'
import { Tr } from '@/context/language-context'
import { ContentPage, ContentSection } from '@/components/marketplace/content-page'
import { PartnerBadge } from '@/components/marketplace/partner-badge'

export const metadata: Metadata = {
  title: `Official partners — ${SITE_NAME}`,
  description:
    'What the gold Partner badge means: how eno picks partner companies, the documents and licences checked before the badge is granted, and what happens if a partner slips.',
  alternates: { canonical: '/partners' },
}

/**
 * THE EXPLAINER BEHIND THE GOLD PARTNER PILL — the /trust of partnerships, and built the same
 * way (ContentPage + ContentSection, flat canvas, hairline rows, no panels).
 *
 * ⚠️ THE ONE SENTENCE THIS PAGE MUST NOT CONTAIN. The owner's brief asked it to say eno
 * "guarantee[s] the quality of service". It does not say that, and the omission is deliberate
 * rather than an oversight — the wording is flagged in the commit and to the owner. Every partner
 * storefront's own bio states the opposite in so many words ("eno introduces GMBR; the booking
 * contract is with them"), because eno.vn is a licensed sàn TMĐT — an intermediary — and a
 * marketplace that publicly guarantees a third party's service has, in one sentence, assumed the
 * liability of the seller for a service it is not licensed to perform. A page that contradicts
 * every storefront it links to is also the first thing a sharp buyer notices.
 *
 * What it does instead is stronger than a bare promise, because each line is a thing eno actually
 * DOES and can be held to: the documents are checked before the badge exists, the badge is
 * revocable, disputes have a room, and partners cannot hide behind a phone number. "No-brainer"
 * comes from specifics a reader can verify, not from the word "guarantee".
 */
/**
 * ⚠️ `title`/`children` ARE ReactNode, NOT string, AND THAT IS AN i18n REQUIREMENT RATHER THAN
 * TASTE. scripts/gen-ui-strings.mjs harvests copy by scanning source for `<Tr text="…">` and
 * `tr('…','…')` LITERALS. Copy handed to a component as a string prop and rendered inside it as
 * `<Tr text={variable}>` is invisible to that scan, so it never reaches src/generated/ui-strings.ts
 * and a Vietnamese reader gets English — silently, with every gate green. (The generator keeps a
 * VARIABLE_RENDERED_COPY escape hatch for files that genuinely cannot avoid this; a page written
 * today should not need to be on that list.) Taking nodes keeps every literal in the JSX below,
 * where the harvester can see it. Caught by all three reviewers.
 */
function Step({ n, title, children }: { n: string; title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 py-4">
      {/* The numeral is the ladder rail — same shape language as /trust's Band, which sets a
          fixed-size mark beside prose rather than a bullet. */}
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-tint text-sm font-bold tabular-nums text-accent-foreground">
        {n}
      </span>
      <div className="min-w-0">
        <div className="text-base font-bold text-foreground">{title}</div>
        <p className="mt-0.5 text-sm leading-relaxed text-body">{children}</p>
      </div>
    </div>
  )
}

/** One "what eno checks" row. Nodes, not strings — see the note on Step. */
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
      intro={
        <p className="text-body leading-relaxed">
          <Tr text="A handful of companies on eno carry a gold Partner badge. It is not advertising and it cannot be bought — eno goes looking for the best company in a category, checks who they actually are, and puts its own name next to theirs." />
        </p>
      }
      sections={[
        { id: 'what', label: 'What the badge means' },
        { id: 'how', label: 'How a partner is chosen' },
        { id: 'checks', label: 'What eno checks' },
        { id: 'keeps', label: 'Keeping the badge' },
        { id: 'position', label: "eno's position" },
      ]}
    >
      <ContentSection id="what" title="What the badge means">
        <div className="flex items-center gap-2">
          <PartnerBadge size="md" />
          <span className="text-sm text-ink-4"><Tr text="on a storefront, a listing, or a chat header" /></span>
        </div>
        <p className="leading-relaxed">
          <Tr text="It means eno chose this company deliberately, verified its licences and company documents, and agreed terms with it directly. Any business can sell on eno. Only a partner has been sought out, checked and vouched for by name." />
        </p>
        <p className="leading-relaxed">
          <Tr text="The badge is granted by a person, never by a score or an algorithm, and it is the only badge on eno that cannot be earned by good behaviour alone." />
        </p>
      </ContentSection>

      <ContentSection id="how" title="How a partner is chosen">
        <p className="leading-relaxed">
          <Tr text="eno starts from the buyer's side. For each service expats actually need, the team surveys what is available in Vietnam, compares real quoted prices against the market, and approaches the companies that come out best on price and on quality of service — not the ones who ask." />
        </p>
        <div className="divide-y divide-border">
          <Step n="1" title={<Tr text="Survey the category" />}>
            <Tr text="The team collects the real offers in a category — what is charged, what is included, how fast it is delivered, and what customers say afterwards." />
          </Step>
          <Step n="2" title={<Tr text="Compare on price and quality together" />}>
            <Tr text="The cheapest company is not automatically the answer. A partner has to be strong on both: competitive against the market, and good enough that eno is willing to attach its name." />
          </Step>
          <Step n="3" title={<Tr text="Check the paperwork" />}>
            <Tr text="Before anything is agreed, eno asks for the company's licences and registration documents and verifies them. A company that cannot produce them is not a partner, whatever it charges." />
          </Step>
          <Step n="4" title={<Tr text="Agree terms directly" />}>
            <Tr text="eno deals with the company itself, so there is a named counterpart and a direct line when something goes wrong — not an anonymous seller account." />
          </Step>
        </div>
      </ContentSection>

      <ContentSection id="checks" title="What eno checks before the badge exists">
        {/* Written out rather than mapped over a tuple array, for the same harvester reason as
            Step above: a string inside an array is not a literal the extractor can see. */}
        <div className="divide-y divide-border">
          <Check title={<Tr text="Business registration" />}>
            <Tr text="The company is a real registered entity, and the name on the storefront is the name on the paperwork." />
          </Check>
          <Check title={<Tr text="Sector licences" />}>
            <Tr text="Whatever that category legally requires to operate in Vietnam — checked for that specific company, not assumed from its website." />
          </Check>
          <Check title={<Tr text="Who is responsible" />}>
            <Tr text="A named contact at the company that eno can reach directly, so a problem has somewhere to go." />
          </Check>
          <Check title={<Tr text="What is actually delivered" />}>
            <Tr text="What the service includes, what it costs, and how long it takes — so the offer on eno matches the offer the buyer receives." />
          </Check>
        </div>
      </ContentSection>

      <ContentSection id="keeps" title="Keeping the badge">
        <p className="leading-relaxed">
          <Tr text="The badge is not permanent. eno watches the same things a buyer would — how fast the company replies, whether reports and disputes are resolved, whether the price stays honest — and removes the badge from a company whose service slips. A partner has more to lose than an ordinary seller, which is the point of granting it at all." />
        </p>
        <p className="leading-relaxed">
          <Tr text="Partners also answer in eno's own chat rather than sending buyers off-platform: there is no phone number to reveal on a partner storefront, so every conversation stays where a dispute can be opened and read later." />
        </p>
      </ContentSection>

      <ContentSection id="position" title="eno's position, stated plainly">
        <p className="leading-relaxed">
          <Tr text="eno is the marketplace, not the provider. The partner performs the service under its own licence and the contract for it is between the buyer and the partner — that is true of a partner exactly as it is of any other seller, and each partner storefront says so." />
        </p>
        <p className="leading-relaxed">
          <Tr text="What changes with a partner is everything around that: eno chose them, checked them, agreed terms with them, keeps their conversations on the platform, and can take the badge away. If something goes wrong with a partner, open a dispute in the chat — eno reads it and follows it up with a company it has a direct relationship with." />
        </p>
      </ContentSection>
    </ContentPage>
  )
}
