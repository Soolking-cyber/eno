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
import { Tr } from '@/context/language-context'
import { ContentPage, ContentSection } from '@/components/marketplace/content-page'
import { AFFILIATION, COMPANY, OPERATOR_REGISTERED, TOS_VERSION } from '@/lib/site-legal'
import { CROSS_SITE_REL, MARKETPLACE_HOME } from '@/lib/cross-site-links'
import { TERMS_SERVICES_COPY } from '@/lib/terms-services-copy'

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
// (src/lib/visa-provider.ts), both of which are placeholders until the documents exist. A number
// typed into a page is a legal defect no lint can see.
//
// ⚠️ SECTION IDS ARE SEMANTIC, NOT POSITIONAL. They were `s0…s9`, which meant `#s7` pointed at a
// different section on each edition (the services build inserts two sections in the middle) and
// would silently re-point again on the next edit. Anchors in these pages get quoted in emails and
// in complaint threads; they have to keep meaning the same thing.

export const metadata: Metadata = {
  title: `Terms of Service | ${SITE_NAME}`,
  description: `The terms that apply when you use ${SITE_NAME}: accounts, listings posted by third parties, our role as an intermediary platform, liability, complaints and governing law.`,
  alternates: { canonical: '/terms' },
}

type Section = { id: string; title: string; paras: string[] }

// ⚠️ THE OPERATOR SENTENCE FORKS ON `OPERATOR_REGISTERED`, WHICH IS NOT A FORMALITY. No company
// exists yet. "Operated by X, business registration no. Y" is a false statement until the ERC is
// issued, and the placeholder text ("đang cập nhật" in a field labelled "registration no.") does
// not read as a disclaimer to anyone. The flag flips in site-legal.ts on the day the certificate
// is in hand, and this paragraph starts asserting the company on its own.
const operatorPara = OPERATOR_REGISTERED
  ? `These Terms govern your use of ${SITE_NAME}, an online classifieds marketplace operated by ${COMPANY.name} (${COMPANY.nameEn}), business registration no. ${COMPANY.erc} (${COMPANY.ercIssued}), head office ${COMPANY.address}.`
  : `These Terms govern your use of ${SITE_NAME}, an online classifieds marketplace for people living in, moving to and visiting Vietnam. They are an agreement between you and the operator of ${SITE_NAME}. The operating company is currently being registered in Vietnam; its registered name, business registration number and head-office address will be published here and in the Operating Regulations as soon as the certificate is issued.`

const sections: Section[] = [
  {
    id: 'acceptance',
    title: 'Acceptance and what these Terms cover',
    paras: [
      operatorPara,
      `By accessing or using ${SITE_NAME} you agree to these Terms, to the Operating Regulations published at /regulations and to the Privacy Policy published at /privacy, both of which form part of them. If you do not agree, please do not use the service.`,
      `The version of these Terms in force is shown at the top of this page. When you confirm acceptance in the app, that version and the date are recorded against your account, so that either side can tell later which terms applied at the time.`,
    ],
  },
  {
    id: 'accounts',
    title: 'Eligibility and accounts',
    paras: [
      `You must be at least 18 years old to use ${SITE_NAME}. Keep your sign-in method secure: you are responsible for everything done through your account. Never share a one-time login code with anyone, including someone claiming to work for us — we will never ask you for one.`,
      `Give accurate information when you register and keep it up to date. Do not impersonate another person or business, and do not create an account to get around a suspension.`,
    ],
  },
  {
    id: 'sellers',
    title: 'Listings are posted by third parties',
    paras: [
      `Every listing is created and published by the person or business offering the item or service — not by us. Sellers write their own descriptions, set their own prices, and must hold whatever licences or permits Vietnamese law requires for what they offer. They are responsible for the accuracy and the legality of everything they post.`,
      `We do not own, hold, inspect, store, ship or deliver the items listed, and we do not select or endorse the sellers who list them.`,
    ],
  },
  {
    id: 'conduct',
    title: 'Posting rules and conduct',
    paras: [
      `You are solely responsible for what you post. Provide truthful information and real photographs of the actual item, and honour the prices you advertise. Marketplace prices must be shown in Vietnamese dong (VND), inclusive of tax.`,
      `You may not post illegal, counterfeit, stolen, unsafe or otherwise prohibited items — the full list is published at /prohibited — and you may not engage in scams, bait pricing, harassment, spam, bulk scraping of other users' contact details, or manipulation of reviews and trust scores. We may remove listings, restrict features, and suspend or close accounts that break these Terms or the law.`,
    ],
  },
  {
    id: 'trust',
    title: 'Trust, verification and moderation',
    paras: [
      `Listings publish after automated checks, and every seller carries a trust score earned from verified activity, reviews and confirmed reports. The method is published in full on the trust page.`,
      `Trust badges and scores reduce risk; they are not a guarantee, an endorsement or a warranty, and they do not make us a party to any transaction. Always inspect an item, meet in a safe public place, and treat an unusually good price as a reason for more caution rather than less.`,
    ],
  },
  {
    id: 'platform',
    title: `${SITE_NAME} is a platform, not a party to the deal`,
    paras: [
      `${SITE_NAME} is an intermediary. We provide a place to publish listings, find them and contact the people behind them. We are not the buyer and not the seller, we take no payment from you for anything listed, we hold no escrow, and we are not responsible for the quality, safety, legality, description, delivery or fitness for purpose of what is listed, or for the conduct of any user.`,
      `Agreements are made between the parties themselves, so your rights over a deal are the rights the law gives you against the other party to it. What we add on top is the report, moderation and complaint process described below and in the Operating Regulations, and we do use it.`,
    ],
  },
  // Services edition only — the words come from an aliased module, the render from the gate.
  ...(IS_SERVICES
    ? [
        { id: 'provider', ...TERMS_SERVICES_COPY.providerSection },
        { id: 'documents', ...TERMS_SERVICES_COPY.documentsSection },
      ]
    : []),
  {
    id: 'fees',
    title: 'Fees',
    paras: [
      `Creating an account, browsing and posting are currently free. We process no payments between buyers and sellers and we hold no money at any point. If paid features for sellers are introduced — a subscription, a promoted listing — they will be announced at least 5 days in advance with prices shown in VND, and paid placement will always be visibly labelled as such.`,
      ...(IS_SERVICES ? TERMS_SERVICES_COPY.feesParas : []),
    ],
  },
  {
    id: 'content',
    title: 'Your content',
    paras: [
      `You keep ownership of what you post. By posting it you grant us a non-exclusive, worldwide, royalty-free licence to host, store, reproduce, translate, resize and display that content for the purpose of operating, improving and promoting the service.`,
      `You confirm that you have the right to post what you upload and that it does not infringe anyone else's rights. The licence ends when you delete the content, except for copies the law requires us to keep and copies in backups that are queued for deletion in the ordinary course.`,
    ],
  },
  {
    id: 'liability',
    title: 'Disclaimers and limitation of liability',
    paras: [
      `${SITE_NAME} is provided "as is" and "as available", without warranties of any kind so far as the law allows. We do not promise that the service will be uninterrupted or error-free, and we do not verify or endorse user-posted content.`,
      `Because we act as an intermediary, we are not liable for loss arising out of a transaction, agreement or dealing between you and another user or a third party you found through the service. To the maximum extent Vietnamese law permits, we are not liable for indirect, incidental, special or consequential loss, or for lost profit, revenue, data or goodwill; and our total liability for any claim connected with the service is limited to the amount, if any, you paid us in the twelve months before the claim arose.`,
      ...(IS_SERVICES ? TERMS_SERVICES_COPY.liabilityParas : []),
      `Nothing in these Terms excludes or limits any liability that Vietnamese law does not allow to be excluded — including your rights under the Law on Protection of Consumer Rights, liability for death or personal injury caused by our negligence, and liability for fraud.`,
    ],
  },
  {
    id: 'complaints',
    title: 'Complaints and reports',
    paras: [
      `Report a listing, a seller or a conversation with the Report control on the item itself, or write to ${COMPANY.email}. Reports are acknowledged within 3 working days and handled through the process set out in the Operating Regulations.`,
      `Complaints about the platform — your account, a moderation decision, the site itself — come to us. A complaint about another user is in the first instance between you and that user: we forward it, we give the parties and the competent authorities the record where the law allows, and we apply our own enforcement where our rules were broken.`,
      ...(IS_SERVICES ? TERMS_SERVICES_COPY.complaintParas : []),
    ],
  },
  {
    id: 'termination',
    title: 'Suspension and termination',
    paras: [
      `We may suspend or terminate access where these Terms or the law are broken, or where it is necessary to protect users or the service. Where it is reasonable to do so we will tell you why and, for anything short of a serious breach, give you a chance to put it right.`,
      `You may stop using ${SITE_NAME} at any time and ask for your account to be deleted, from your account settings or by writing to ${COMPANY.email}. Deletion is handled as described in the Privacy Policy.`,
    ],
  },
  {
    id: 'law',
    title: 'Governing law and disputes',
    paras: [
      `These Terms and your use of ${SITE_NAME} are governed by the law of Vietnam. A dispute between you and us that cannot be settled amicably goes to the competent court in Ho Chi Minh City, Vietnam. Consumers keep every protection Vietnamese consumer-protection law gives them, including the right to complain to consumer-protection authorities and organizations, and nothing here takes that away.`,
      `Disputes between users are between those users. The complaint process described above and in the Operating Regulations sets out how we assist.`,
    ],
  },
  {
    id: 'related',
    title: 'Related sites',
    paras: [AFFILIATION.en],
  },
  {
    id: 'changes',
    title: 'Changes to these Terms, and contact',
    paras: [
      `We may update these Terms as the law or the product changes. Material changes are announced on the platform at least 5 days before they take effect, and the version shown at the top of this page changes with them. Continuing to use the service after the effective date means you accept the new version; if you do not, please stop using it, and you may ask for your account to be deleted.`,
      `Questions about these Terms: ${COMPANY.email}.`,
    ],
  },
  // A stub-fed section is empty on the marketplace edition. The gates above already prevent that,
  // and this is the belt to their braces: a future call site that forgets one renders nothing
  // rather than an untitled heading.
].filter((s) => s.title && s.paras.length > 0)

export default function TermsPage() {
  return (
    <ContentPage
      eyebrow="Legal"
      title="Terms of Service"
      meta={
        <>
          <p className="mt-3 text-sm text-ink-4">
            {/* ⚠️ THE VERSION IN FORCE IS THE HEADLINE, NOT THE NEWEST ONE. During the notice window
                these differ, and printing the new number under the word "Version" tells a reader
                the new terms govern them — which is exactly what the window exists to deny. An
                external review flagged it: "a reasonable reader could believe it already governs
                despite the adjacent notice". The published-but-pending version is named in the
                notice beside this, where it reads as a future date rather than today's rule. */}
            <Tr text="Last updated: August 2026" /> · <Tr text="Version" /> {TOS_VERSION}
          </p>
          <p className="mt-2 max-w-3xl text-xs text-muted-foreground italic"><Tr text="This translation is provided for your convenience. The English version of these terms is the authoritative one." /></p>
        </>
      }
      sections={sections.map((s) => ({ id: s.id, label: s.title }))}
    >
      {sections.map((s) => (
        <ContentSection key={s.id} id={s.id} title={s.title}>
          <div className="space-y-2">
            {s.paras.map((p, j) => (
              <p key={j} className="text-base leading-relaxed text-body"><Tr text={p} /></p>
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
