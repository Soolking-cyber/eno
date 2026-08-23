import type { Metadata } from 'next'
import Link from 'next/link'
import { SITE_NAME } from '@/lib/edition'
import { Tr } from '@/context/language-context'
import { ContentPage, ContentSection } from '@/components/marketplace/content-page'
import { COMPANY, OPERATOR_REGISTERED } from '@/lib/site-legal'

/**
 * CONTACT — a trust-anchor page, which is a different job from a contact form.
 *
 * ⚠️ WHY A DEDICATED ROUTE WHEN /about ALREADY HAS A #contact SECTION. Two readers need this and
 * neither finds an anchor: Vietnamese e-commerce law expects a published, reachable identity for
 * the operating entity, and agents (and search engines) probe `/contact` by convention when
 * deciding whether a business is real before recommending it. `/about#contact` answered neither.
 * The section there stays — it is one line and in the right place for someone already reading
 * about the product.
 *
 * ⛔ EVERY FACT ON THIS PAGE COMES FROM src/lib/site-legal.ts, NEVER TYPED HERE. COMPANY is
 * OPERATORS[EDITION], so the address, registration number and phone are already the right ones for
 * whichever deployment renders this. Typing them would create a second copy that drifts, and the
 * copy on the page a regulator reads is the worst one to have drift.
 *
 * ⛔ NO SERVICES VOCABULARY MAY BE A LITERAL IN THIS FILE — same rule as src/app/about/page.tsx,
 * for the same non-obvious reason. `scripts/gen-ui-strings.mjs` harvests every `<Tr text="…">` in
 * `src/**` into a catalogue SHIPPED TO THE BROWSER, and classifies a string services-only by the
 * PATH it was found in. `src/app/contact/` is not on that list, so a services word written here
 * lands in the catalogue every eno.vn visitor downloads — a leak that renders nowhere and is
 * present in the artifact anyway. Keep this page about reaching the operator, nothing else.
 */

export const metadata: Metadata = {
  title: `Contact ${SITE_NAME}`,
  description: `How to reach ${SITE_NAME} — support email, phone, registered address and the fastest route for account, listing or safety questions.`,
  alternates: { canonical: '/contact' },
}

const LINK = 'font-semibold text-accent-foreground hover:underline'

/**
 * ⚠️ THE UNREGISTERED BRANCH IS NOT A FORMALITY. Until the certificate is issued there is no
 * number to publish, and printing a placeholder in a field labelled "business registration" reads
 * as a fact rather than as an absence. Flipping `registered` in site-legal.ts is what turns this
 * into a statement — see the identical gate on /about.
 */
const OPERATOR_LINE = OPERATOR_REGISTERED
  ? `${SITE_NAME} is operated by ${COMPANY.name} (${COMPANY.nameEn}). Registered office: ${COMPANY.address}. Business registration no. ${COMPANY.erc}, issued ${COMPANY.ercIssued} by ${COMPANY.ercAuthority}.`
  : `${SITE_NAME} is run by a Vietnamese company that is still completing its business registration. Until the certificate is issued there is no registration number to publish; this page is updated the day it arrives.`

const RAIL = [
  { id: 'support', label: 'Get help' },
  { id: 'operator', label: 'Who operates this site' },
  { id: 'reporting', label: 'Reporting a problem' },
  { id: 'privacy', label: 'Privacy and your data' },
]

export default function ContactPage() {
  return (
    <ContentPage
      title="Contact us"
      intro={<Tr text="Every message reaches a person. Below is who runs this site, how to reach us, and which route gets you an answer fastest." />}
      sections={RAIL}
    >
      <ContentSection id="support" title="Get help">
        <p className="text-sm text-body">
          <Tr text="For anything about your account, a listing, a message or a payment question, email" />{' '}
          <a href={`mailto:${COMPANY.email}`} className={LINK}>{COMPANY.email}</a>
          {OPERATOR_REGISTERED ? (
            <>
              {' '}<Tr text="or call" />{' '}
              <a href={`tel:${COMPANY.phone}`} className={LINK}>{COMPANY.phone}</a>
            </>
          ) : null}
          . <Tr text="We answer in Vietnamese and English." />
        </p>
        <p className="text-sm text-body">
          {/* The fastest route is genuinely not email, and saying so is more useful than a form.
              A signed-in user's thread carries the listing and the counterparty already. */}
          <Tr text="If your question is about a specific listing or a conversation, the quickest route is the in-app thread — it already carries the context, so nobody has to ask you for links or screenshots." />{' '}
          <Link href="/help" className={LINK}><Tr text="The help centre" /></Link>{' '}
          <Tr text="covers accounts, messaging, offers and safety, and answers most questions without waiting for a reply." />
        </p>
      </ContentSection>

      <ContentSection id="operator" title="Who operates this site">
        <p className="text-sm text-body"><Tr text={OPERATOR_LINE} /></p>
        {OPERATOR_REGISTERED ? (
          <p className="text-sm text-body">
            <Tr text="Correspondence and legal notices can be sent to that address or to" />{' '}
            <a href={`mailto:${COMPANY.email}`} className={LINK}>{COMPANY.email}</a>.{' '}
            <Tr text="The person responsible for content is" /> {COMPANY.contentManager}.
          </p>
        ) : null}
      </ContentSection>

      <ContentSection id="reporting" title="Reporting a problem">
        <p className="text-sm text-body">
          {/* ⚠️ Points at the in-product control rather than an inbox on purpose: a report filed
              through the app is deduplicated, attached to the item, and visible to moderation.
              An email about a listing arrives with none of that. */}
          <Tr text="Every listing and every profile has a Report control. Use it rather than email where you can — a report filed in the app is attached to the item and reaches moderation directly, which is both faster and easier to act on." />{' '}
          <Link href="/safety" className={LINK}><Tr text="Safe trading" /></Link>{' '}
          <Tr text="explains what we check and what to watch for when meeting or paying." />
        </p>
        <p className="text-sm text-body">
          <Tr text="If someone is in immediate danger, contact the local authorities first. We can help with the account afterwards." />
        </p>
      </ContentSection>

      <ContentSection id="privacy" title="Privacy and your data">
        <p className="text-sm text-body">
          <Tr text="To ask what personal data we hold, request a copy, or ask us to delete your account, email" />{' '}
          <a href={`mailto:${COMPANY.privacyEmail}`} className={LINK}>{COMPANY.privacyEmail}</a>.{' '}
          <Tr text="You can also export or delete your data yourself from account settings — that route is immediate and does not wait on us." />{' '}
          <Link href="/privacy" className={LINK}><Tr text="Our privacy policy" /></Link>{' '}
          <Tr text="sets out what we collect and why." />
        </p>
      </ContentSection>
    </ContentPage>
  )
}
