import type { Metadata } from 'next'
import Link from 'next/link'
import { ShieldCheck, Eye, BadgeCheck } from 'lucide-react'
import { IS_SERVICES, SITE_NAME } from '@/lib/edition'
import { Tr } from '@/context/language-context'
import { ContentPage, ContentSection } from '@/components/marketplace/content-page'
import { AFFILIATION, COMPANY, OPERATOR_REGISTERED } from '@/lib/site-legal'
import { PROVIDER_LICENCE_ON_FILE, PROVIDER_OF_RECORD } from '@/lib/visa-provider'
import { Bilingual } from './bilingual'

/**
 * ABOUT — ONE FILE, TWO EDITIONS, AND THE PAGE WHERE THE AFFILIATION IS DISCLOSED.
 *
 * This route exists on BOTH deployments (src/lib/edition.ts): eno.vn, the licensed sàn TMĐT
 * marketplace, and eno.forum, which additionally lists services sold by a licensed third-party
 * partner. Everything below is written twice on purpose. Read all three rules before editing.
 *
 * ⚠️ 1. NO SERVICES VOCABULARY MAY BE A LITERAL IN THIS FILE. Not because of what renders — the
 * IS_SERVICES gates handle that — but because of where the strings go. `scripts/gen-ui-strings.mjs`
 * harvests every `<Tr text="literal">` and `tr('literal')` in `src/**` into a catalogue that is
 * SHIPPED TO THE BROWSER to pre-warm translations, and it classifies a string as services-only from
 * the PATH it was found in. `src/app/about/` is not in that list and must not be (the marketplace
 * half of this page belongs in the core catalogue), so a literal written here lands in
 * `src/generated/ui-strings.ts` and is downloaded by every eno.vn visitor even though nothing on
 * eno.vn renders it. That is the exact leak class the edition split exists to prevent.
 *
 * So the services-only wording arrives from `@/lib/visa-provider`, which next.config.ts ALIASES to
 * a stub of empty strings on a marketplace build, and the edition-specific prose written inline
 * here is passed through VARIABLES (the arrays below) rather than literals — the harvester only
 * matches literals, so none of it reaches the catalogue either way. The result is checkable with
 * grep: no partner name, and no word describing what the partner is licensed to do, anywhere in
 * what eno.vn serves.
 *
 * ⚠️ 2. THREE CLAIMS THIS PAGE MAY NEVER MAKE.
 *   · that eno performs or guarantees the partner's service — the partner is the provider of
 *     record, under its own licence, and PROVIDER_OF_RECORD is the only sentence that says who;
 *   · that a company exists which has not been registered yet — hence OPERATOR_REGISTERED gating
 *     the operator paragraph, and hence no company name, registration number or licence number
 *     typed into this file. They live in src/lib/site-legal.ts and src/lib/visa-provider.ts;
 *   · that eno.vn and eno.forum are unrelated. They are related, and this page is the single best
 *     natural home for saying so — see AFFILIATION.
 *
 * ⚠️ 3. THE OUTBOUND LINKS ARE DELIBERATELY ONE-WAY. The services edition links INTO eno.vn's
 * marketplace landing pages (that is the point of the section: someone who has just arrived needs
 * housing, a bike and work). The marketplace edition names eno.forum in the affiliation paragraph
 * but does NOT link to it: eno.vn is registering as a licensed marketplace and may not advertise a
 * service it is not licensed for, and a hyperlink is a referral rather than a disclosure. Naming
 * the sister site is the honest disclosure; sending traffic to it is a different act. Do not
 * "balance" the links.
 */

// The services description says what the service is by INTERPOLATING the aliased constant rather
// than by naming it — on a marketplace build PROVIDER_OF_RECORD.shortEn is an empty string and this
// branch is dead code anyway. `canonical: '/about'` is relative on purpose: it resolves against
// each build's metadataBase, so eno.forum's About page canonicalises to eno.forum.
const SERVICES_DESCRIPTION = `About eno.forum — services for travellers and newcomers to Vietnam. ${PROVIDER_OF_RECORD.shortEn} eno.vn, our sister marketplace, covers housing, jobs, motorbikes and secondhand once you are here.`
const MARKETPLACE_DESCRIPTION =
  'What eno.vn is and how it works: a classifieds marketplace for Vietnam — housing, jobs, motorbikes, services and secondhand — with public seller trust scores, automated checks on every post, and no payments on the platform.'

export const metadata: Metadata = {
  title: `About | ${SITE_NAME}`,
  description: IS_SERVICES ? SERVICES_DESCRIPTION : MARKETPLACE_DESCRIPTION,
  alternates: { canonical: '/about' },
}

const LINK = 'font-semibold text-accent-foreground hover:underline'

/** eno.vn destinations linked from the services edition. Absolute: they are cross-domain there. */
const MARKETPLACE_URL = 'https://eno.vn'

// ── Copy ────────────────────────────────────────────────────────────────────────────────────────
// Held in arrays rather than written inline as JSX literals — see rule 1 in the header. The prose
// is plain on purpose: a reader deciding whether to trust a site should not have to parse a
// contract, and every sentence here still has to be true.

const MARKETPLACE_INTRO =
  'eno.vn is a classifieds marketplace for expats, internationals and locals in Vietnam — housing, jobs, motorbikes, everyday services and secondhand. Every seller carries a public trust score, automated checks run on every post, and anyone can report a listing that is not what it claims to be.'

const MARKETPLACE_WHAT = [
  'People post what they are renting out, selling or hiring for: apartments and rooms, jobs, motorbikes and cars, services, and the furniture and appliances that change hands every time somebody moves.',
  'The listings belong to the people who post them. eno.vn does not own or supply what you see, and it is not a party to the deal you make — there is no checkout, no escrow and no payment on the platform. You message a seller in the app, agree between yourselves, and settle directly.',
  'Prices are set in Vietnamese đồng, and the site reads in your own language: listings, chat and the interface are translated as you go.',
]

// ⚠️ "EACH SERVICE", SINGULAR AND SCOPED, ON PURPOSE. "our licensed partners" would imply a roster
// (there is one partner today), and an unscoped "everything here comes from a licensed company"
// would be false — eno.forum also carries ordinary marketplace listings from ordinary people.
const SERVICES_INTRO =
  'eno.forum is for people on their way to Vietnam — visitors, newcomers, and people moving here for work or study. Each service listed here is provided by a licensed third-party company, not by eno.forum: we publish the listing and pass your request on, and the partner does the work.'

const SERVICES_WHAT = [
  'eno.forum is a platform, not a service provider. It publishes what a partner offers, hands your request to that partner, and gives you one place to talk to them. The partner does the work under its own licence, sets its own prices and terms, and answers for the result. eno.forum receives a commission when a service is booked through the platform.',
  'Alongside that, eno.forum runs the same classifieds marketplace you will find on eno.vn: third-party listings, public seller trust scores, no checkout, and deals agreed directly between the two people involved.',
]

/**
 * Follows the provider-of-record disclosure.
 *
 * ⚠️ IT PROMISES NOTHING THE CODE DOES NOT DO. No retention period, no "we never store it": it says
 * what an upload is used for and who it goes to, and sends the reader to the policy for the rest.
 * A number invented here would be a commitment nobody implemented.
 */
const SERVICES_PROVIDER_DATA =
  'Anything you upload for a service — documents, photos and the details a request needs — is used to prepare and submit that request, and is shared with the partner performing it. What is stored, for how long, and how to ask for it to be deleted is set out in our'

/**
 * Only rendered once verified copies of the partner's paperwork are actually held (Advertising Law
 * 75/2025 puts that duty on the party publishing the advertisement, not on the partner). While
 * PROVIDER_LICENCE_ON_FILE is false this sentence must not appear — saying it early would be the
 * one claim on this page nobody could check.
 */
const SERVICES_PROVIDER_LICENCE =
  'We hold copies of that partner’s company registration and operating licence on file.'

const SERVICES_MARKETPLACE_LEAD =
  'is our sister marketplace: a classifieds site for people already living in Vietnam. It is where the practical side of arriving gets solved — somewhere to live, something to ride, work, and everything a departing expat is selling off.'

/**
 * The cross-domain links, as data.
 *
 * ⚠️ THE SENTENCE FRAGMENTS ARE VARIABLES FOR THE SAME REASON THE PROSE ABOVE IS — see rule 1. They
 * are also split so each fragment is a clause that survives translation on its own; a link dropped
 * into the middle of one translated string cannot be, because the layer translates strings, not
 * trees.
 *
 * `path` is appended to MARKETPLACE_URL, so these are absolute cross-domain links from eno.forum.
 * Each target is a real marketplace landing route (src/app/<path>/page.tsx) — a plain page.tsx, so
 * it exists on both editions and cannot 404 the way a `.svc.` route would.
 */
const SERVICES_MARKETPLACE_LINKS = [
  {
    path: '/housing-vietnam-expats',
    lead: 'Somewhere to live usually comes first:',
    label: 'housing and apartment rentals for expats',
    tail: '— studios in Thao Dien, apartments in Phu My Hung, family houses in District 2.',
  },
  {
    path: '/motorbikes-for-sale-vietnam',
    lead: 'Then a way to get around:',
    label: 'motorbikes for sale and rent in Vietnam',
    tail: '— rent one by the month while you settle in, or buy a used bike outright.',
  },
  {
    path: '/jobs-vietnam-expats',
    lead: 'Staying on to work?',
    label: 'jobs for expats and internationals in Vietnam',
    tail: '— teaching, hospitality, marketing, design and tech roles where English is required.',
  },
]

const SERVICES_MARKETPLACE_TAIL =
  'The same rules apply there: the listings belong to the people who post them, there is no checkout, and you settle directly with the seller.'

const AFFILIATION_PLAIN =
  'In plain terms: one brand family, two websites, and each one answers for what happens on its own domain. Whichever site you are on, its own terms and privacy policy are the ones that apply to you.'

/**
 * ⚠️ NO COMPANY NAME OR NUMBER IS TYPED HERE, and the unregistered branch is not a formality. Until
 * the certificate is issued there is nothing to assert, and "đang cập nhật" printed in a field
 * labelled "registration no." does not tell a reader that no company exists yet. Flipping
 * `registered` in src/lib/site-legal.ts is what turns this into a statement of fact.
 */
const OPERATOR_LINE = OPERATOR_REGISTERED
  ? `${SITE_NAME} is operated by ${COMPANY.name} (${COMPANY.nameEn}), head office ${COMPANY.address}. Business registration no. ${COMPANY.erc}, issued ${COMPANY.ercIssued}.`
  : `${SITE_NAME} is run by a Vietnamese company that is still completing its business registration. Until the certificate is issued there is no registration number to publish: the operator block on our Operating Regulations page shows what is confirmed so far, and is filled in the day the certificate arrives.`

const STEPS = [
  {
    icon: <Eye className="h-5 w-5" />,
    title: 'Listing submitted',
    text: 'A seller posts an item with photos, price and location.',
  },
  {
    icon: <ShieldCheck className="h-5 w-5" />,
    title: 'Automated checks',
    text: 'Every post runs automated checks — phone verified, no contact details hidden in the text, and enough real photos to show what is being offered.',
  },
  {
    icon: <BadgeCheck className="h-5 w-5" />,
    title: 'It goes live instantly',
    text: 'Listings publish right away. Sellers build a public trust score and buyers can report problems — so fakes and bait prices do not last.',
  },
]

/**
 * The left rail. ⚠️ Every id here must match a rendered ContentSection on the SAME edition — a rail
 * entry pointing at a section that only the other edition renders is a link that scrolls nowhere,
 * and nothing type-checks the pair. Keep the two lists side by side in a diff.
 */
const RAIL = IS_SERVICES
  ? [
      { id: 'what', label: 'What eno.forum is' },
      { id: 'provider', label: 'Who provides the services' },
      { id: 'trust', label: 'How trust works' },
      { id: 'marketplace', label: 'The eno.vn marketplace' },
      { id: 'affiliation', label: 'How the two sites relate' },
      { id: 'operator', label: 'Who runs this site' },
      { id: 'contact', label: 'Contact' },
    ]
  : [
      { id: 'what', label: 'What eno.vn is' },
      { id: 'trust', label: 'How trust works' },
      { id: 'affiliation', label: 'How the two sites relate' },
      { id: 'operator', label: 'Who runs this site' },
      { id: 'contact', label: 'Contact' },
    ]

function Para({ text }: { text: string }) {
  return (
    <p className="text-base leading-relaxed text-body">
      <Tr text={text} />
    </p>
  )
}

export default function AboutPage() {
  return (
    <ContentPage
      eyebrow={IS_SERVICES ? 'About eno.forum' : 'About eno.vn'}
      title={IS_SERVICES ? 'Before you arrive, and after you land.' : 'The trusted marketplace for Vietnam.'}
      intro={<Tr text={IS_SERVICES ? SERVICES_INTRO : MARKETPLACE_INTRO} />}
      sections={RAIL}
    >
      <ContentSection id="what" title={IS_SERVICES ? 'What eno.forum is' : 'What eno.vn is'}>
        {(IS_SERVICES ? SERVICES_WHAT : MARKETPLACE_WHAT).map((p, i) => (
          <Para key={i} text={p} />
        ))}
      </ContentSection>

      {IS_SERVICES && (
        <ContentSection id="provider" title="Who provides the services listed here">
          {/* The disclosure itself: authored in both languages, so it is rendered rather than
              machine-translated. It names the partner, says the partner is the provider of record,
              and says what eno.forum is and is not. */}
          <p className="text-base leading-relaxed text-body">
            <Bilingual en={PROVIDER_OF_RECORD.en} vi={PROVIDER_OF_RECORD.vi} />
          </p>
          {PROVIDER_LICENCE_ON_FILE && <Para text={SERVICES_PROVIDER_LICENCE} />}
          <p className="text-base leading-relaxed text-body">
            <Tr text={SERVICES_PROVIDER_DATA} />{' '}
            <Link href="/privacy" className={LINK}>
              <Tr text="Privacy Policy" />
            </Link>
            .
          </p>
        </ContentSection>
      )}

      <ContentSection id="trust" title="How trust works" wide>
        <div className="grid gap-x-8 gap-y-6 sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <div key={i}>
              <span className="flex h-8 w-8 items-center justify-center text-accent-foreground">{s.icon}</span>
              <h3 className="mt-3 text-sm font-bold text-foreground">
                {i + 1}. <Tr text={s.title} />
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-body">
                <Tr text={s.text} />
              </p>
            </div>
          ))}
        </div>
      </ContentSection>

      {IS_SERVICES && (
        // The cross-domain section. Plain <a>, no rel="nofollow" and no target: these are ordinary
        // editorial links to the sister site, and they are the reason this section exists.
        <ContentSection id="marketplace" title="eno.vn — for once you are here">
          <p className="text-base leading-relaxed text-body">
            <a href={MARKETPLACE_URL} className={LINK}>
              eno.vn
            </a>{' '}
            <Tr text={SERVICES_MARKETPLACE_LEAD} />
          </p>
          {SERVICES_MARKETPLACE_LINKS.map((l) => (
            <p key={l.path} className="text-base leading-relaxed text-body">
              <Tr text={l.lead} />{' '}
              <a href={`${MARKETPLACE_URL}${l.path}`} className={LINK}>
                <Tr text={l.label} />
              </a>{' '}
              <Tr text={l.tail} />
            </p>
          ))}
          <Para text={SERVICES_MARKETPLACE_TAIL} />
        </ContentSection>
      )}

      <ContentSection id="affiliation" title="How eno.vn and eno.forum relate">
        {/* Disclosed affiliation, not independence — claiming the sites are unrelated would be
            false, and a false disclosure is worse than none. Authored in both languages. */}
        <p className="text-base leading-relaxed text-body">
          <Bilingual en={AFFILIATION.en} vi={AFFILIATION.vi} />
        </p>
        <Para text={AFFILIATION_PLAIN} />
      </ContentSection>

      <ContentSection id="operator" title="Who runs this site">
        <Para text={OPERATOR_LINE} />
        <p className="text-base leading-relaxed text-body">
          <Tr text="The rules for using the site, the operator notice Vietnamese law requires, and how your personal data is handled are set out on three pages:" />{' '}
          <Link href="/terms" className={LINK}>
            <Tr text="Terms of Service" />
          </Link>
          ,{' '}
          <Link href="/regulations" className={LINK}>
            <Tr text="Operating Regulations" />
          </Link>{' '}
          <Tr text="and" />{' '}
          <Link href="/privacy" className={LINK}>
            <Tr text="Privacy Policy" />
          </Link>
          .
        </p>
      </ContentSection>

      <ContentSection id="contact" title="Contact">
        <p className="text-sm text-body">
          <Tr text="Questions, problems or press:" />{' '}
          <a href={`mailto:${COMPANY.email}`} className={LINK}>
            {COMPANY.email}
          </a>
        </p>
      </ContentSection>
    </ContentPage>
  )
}
