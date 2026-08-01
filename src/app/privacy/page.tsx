import { SITE_NAME, IS_SERVICES } from '@/lib/edition'
import type { Metadata } from 'next'
import { Tr } from '@/context/language-context'
import { ContentPage, ContentSection } from '@/components/marketplace/content-page'
import { CookieSettingsButton } from '@/components/marketplace/cookie-settings-button'
import { AFFILIATION, COMPANY, OPERATOR_REGISTERED } from '@/lib/site-legal'
import {
  PRIVACY_SERVICES_COLLECT,
  PRIVACY_SERVICES_CONTROLLER,
  PRIVACY_SERVICES_PURPOSES,
  PRIVACY_SERVICES_RECIPIENTS,
  PRIVACY_SERVICES_RETENTION,
  PRIVACY_SERVICES_SECTIONS,
  type PrivacySection,
} from '@/lib/privacy-services-copy'

export const metadata: Metadata = {
  title: `Privacy Policy | ${SITE_NAME}`,
  description: `How ${SITE_NAME} collects, uses, shares and protects personal data under Vietnam’s Personal Data Protection Law 91/2025 — sensitive data, processing outside Vietnam, and the rights you can exercise.`,
  alternates: { canonical: '/privacy' },
}

// ── Privacy policy — Personal Data Protection Law 91/2025/QH15 + Decree 356/2025/ND-CP ──────────
//
// Rewritten 2026-08 for the platform/provider split. What the law actually demands of this page,
// and where each demand is answered:
//   · controller identity + contact                    → "Who is responsible" (COMPANY, per edition)
//   · categories of data, sensitive data called out    → "What personal data we collect" (+ visa)
//   · purpose AND legal basis, per purpose             → "Why we use your data…"
//   · recipients, and the processor relationship       → "Who else receives your data"
//   · cross-border transfer notice + the MPS dossier   → "Processing outside Vietnam"
//   · rights WITH the statutory clocks                 → "Your rights…" (2 / 10 / 15 / 20 days)
//   · 72-hour breach notification                      → "Security, and what happens if…"
//   · retention limited to purpose                     → "How long we keep your data"
//   · consent: express, per-purpose, withdrawable      → "Cookies and tracking" + the basis para
//
// ⚠️ THIS ONE FILE IS SERVED BY BOTH EDITIONS and must be complete and true on each. A privacy
// policy cannot 404 on the licensed marketplace, so eno.vn compiles every string below. That is why
// the services-only paragraphs are IMPORTED from @/lib/privacy-services-copy rather than written
// inline behind an `IS_SERVICES ?` ternary: next.config.ts aliases that module to an empty stub on a
// marketplace build, which is the only thing that removes the words from the artifact. The gates
// here control what RENDERS; the alias controls what SHIPS.
//
// ⚠️ AND THERE IS A SECOND WAY OUT OF THIS PAGE, which is why "just put it in an IS_SERVICES branch"
// is worse than it looks. scripts/gen-ui-strings.mjs harvests `<Tr text="…">` JSX literals into
// src/generated/ui-strings.ts, a file SHIPPED TO THE BROWSER on every page to pre-warm translations.
// The paragraphs below escape it only because they are rendered from an array (`<Tr text={p} />`),
// which the harvester does not match — measured 2026-08-01, none of them are in the catalogue. Write
// the next sentence the obvious way, as a `<Tr text="…">` literal in the JSX below, and it lands in
// that catalogue. Read the module header before adding anything about visa here.
//
// ⚠️ KEEP IN SYNC WITH THE THINGS THIS PAGE DESCRIBES, because a privacy policy is the one document
// that goes stale silently: src/lib/consent.ts (the three tiers named below), the providers actually
// wired (checked 2026-08-01 — Upstash and Vercel were named here and are BOTH retired: rate-limit
// state moved into Postgres, hosting moved to Cloud Run, and there is no @vercel/analytics in the
// tree), and the retention behaviour in src/app/api/cron/visa-retention.
//
// ⚠️ NO NUMBER OF DAYS FOR RETENTION, deliberately. The statutory RESPONSE clocks below are fixed by
// law and are safe to print. A retention period is not: it lives in the data, changes without this
// file being touched, and a policy naming the wrong one is a false statement, not a stale comment.

/**
 * ⚠️ EACH SECTION CARRIES ITS OWN ANCHOR ID, AND THEY ARE SEMANTIC, NOT POSITIONAL. These were
 * `s${index}`, which had two consequences: the services edition splices a section into the middle,
 * so `#s5` meant a DIFFERENT section on each deployment, and adding any section silently re-pointed
 * every anchor after it. Privacy anchors get quoted in rights requests, in complaint threads and in
 * emails — they have to keep meaning the same thing. /terms carries its ids for the same reason;
 * `PrivacySection` in @/lib/privacy-services-copy is the matching shape for the spliced sections.
 */
const baseSections: PrivacySection[] = [
  [
    'controller',
    'Who is responsible for your data',
    [
      'This policy explains what personal data we process, why, who else receives it, and the rights Vietnamese law gives you. It is written to the Personal Data Protection Law 91/2025/QH15 and Decree 356/2025/ND-CP. Those use “personal data” for anything that identifies you, and “sensitive personal data” for a narrower set the law protects more strictly — we use the same words here, and say which is which.',
      `The data controller — the party that decides why and how your data is processed — is ${COMPANY.name}, ${COMPANY.address}. Anything to do with personal data, including a request to exercise the rights below, goes to ${COMPANY.privacyEmail}. We acknowledge every such request within 2 working days.`,
      AFFILIATION.en,
      ...(IS_SERVICES ? PRIVACY_SERVICES_CONTROLLER : []),
    ],
  ],
  [
    'what-we-collect',
    'What personal data we collect',
    [
      'Account information: when you sign in we receive your email address and/or phone number, and — if you use Google sign-in — your name and profile picture from Google.',
      'Listing information: the title, description, price, photos, location and contact phone number you choose to include when you post a listing. What you put in a listing is published, so treat that field as public.',
      'Messages: conversations you have with other users through the on-platform chat. We keep them so both sides have a record and so a report of fraud or abuse can be reviewed fairly.',
      'Usage information: device type, language and currency preference, pages viewed, and on-site activity such as searches and listing views. We also keep a limited technical log, including IP address, to apply rate limits and block abuse — that log lives in our own database and is not sent to a third party.',
      'Location: if you allow it, your device location is used to sort listings by distance and to place you on the map. Location data is sensitive personal data under Vietnamese law, so we use it only for the feature you asked for, never share it with advertisers, and stop collecting it the moment you withdraw the browser permission. We hold your on-site behavioural data to the same standard.',
      ...(IS_SERVICES ? PRIVACY_SERVICES_COLLECT : []),
    ],
  ],
  ...(IS_SERVICES ? PRIVACY_SERVICES_SECTIONS : []),
  [
    'why-and-basis',
    'Why we use your data, and on what legal basis',
    [
      'To create and secure your account and let you sign in.',
      'To publish your listings after automated checks, and to connect buyers with sellers.',
      'To prevent fraud and abuse, run the trust-score system, handle reports and disputes, and keep the marketplace safe for everyone using it.',
      'To translate listing and interface content into the language you choose.',
      'To answer your questions, reports and support requests.',
      'With your consent only: to measure the service with analytics, to personalise what you see using your own activity on this site, and to send conversion signals to advertising platforms. Those three are described under “Cookies and tracking”.',
      ...(IS_SERVICES ? PRIVACY_SERVICES_PURPOSES : []),
      'The basis for all of this is your consent: expressed by a clear action, asked for separately for each purpose that needs it, never bundled into a single take-it-or-leave-it box, and withdrawable at any time without losing access to the parts of the service that do not depend on it. Where Vietnamese law allows processing without consent we rely only on the narrow grounds it lists — performing a contract you asked us to perform, meeting a legal obligation such as keeping e-commerce records, protecting someone’s life or health in an emergency, and answering a lawful request from a competent state authority. We do not sell personal data and we do not trade in it; Vietnamese law prohibits that, and so do we.',
    ],
  ],
  [
    'recipients',
    'Who else receives your data',
    [
      'We use a small number of providers strictly to run this service, each bound by a data-processing agreement and each given only the data its job needs: Supabase (authentication, the database, and private file storage), Google Cloud (the servers this site runs on, Google Cloud Translation for content translation, and Vertex AI for search and assistant features), Cloudflare (network security, DDoS protection and the sign-in CAPTCHA), Microsoft Azure Translator (fallback translation), Resend (transactional email such as sign-in links and notifications), and messaging providers (Telegram, WhatsApp, Zalo and SpeedSMS) that deliver one-time login codes.',
      'With your consent only: Google Analytics, and Meta for conversion measurement — including events sent from our server, which need the same opt-in as a browser pixel and are withheld without it. If you have not chosen “Allow all”, neither receives anything about you.',
      ...(IS_SERVICES ? PRIVACY_SERVICES_RECIPIENTS : []),
      'We also disclose data when Vietnamese law requires it: to a competent state authority acting within its powers, and where we must report information about sellers (for example to the tax authority). Where we are permitted to tell you about such a disclosure, we will.',
    ],
  ],
  [
    'cross-border',
    'Processing outside Vietnam',
    [
      'Several of the providers above run on servers outside Vietnam, mainly in Singapore. Under Vietnamese law that is a cross-border transfer of personal data, and it carries its own duties: the transfer must be documented and assessed, the assessment must be filed with the Ministry of Public Security and kept current, and you must be told the transfer is happening. This paragraph is that notice.',
      // ⚠️ THIS FORK IS NOT STYLE. "We have filed a dossier with the Ministry" is an act performed by
      // a registered entity; asserting it before the ERC exists is exactly the invention
      // src/lib/site-legal.ts is built to prevent, and a placeholder elsewhere on the page does not
      // read as a disclaimer on this sentence. OPERATOR_REGISTERED flips when the certificate is in
      // hand — then, and only then, does the first branch become true.
      // ⚠️ Two whole literals rather than one sentence with a swapped clause: legal copy is read and
      // approved as a paragraph, and a composed string is a paragraph nobody ever reviewed.
      OPERATOR_REGISTERED
        ? 'We maintain a cross-border transfer impact assessment and a processing impact assessment, file them with the Ministry of Public Security, and update them as our providers change.'
        : 'The cross-border transfer impact assessment and the processing impact assessment are being prepared and will be filed with the Ministry of Public Security as our company registration completes. Until then the transfers are documented internally and covered by each provider’s data-processing agreement. We would rather tell you exactly where this stands than claim a filing that has not happened yet.',
    ],
  ],
  [
    'cookies',
    'Cookies and tracking',
    [
      'Essential storage keeps you signed in and remembers your language, your currency and your saved listings. It always works, and it tracks nothing about you across other sites.',
      'On-site personalisation — the “For You” row, built from your own activity on this site — is ranked on our own servers and never leaves us. Choosing “Essential only” switches it off.',
      'Analytics and advertising — Google Analytics, and Meta conversion signals including the ones our server sends — run only if you choose “Allow all”. Decline and no third-party tracking runs, server-side included. You can change your mind at any time with the button at the end of this page; withdrawing consent stops the trackers immediately and does not cost you any part of the service.',
    ],
  ],
  [
    'your-rights',
    'Your rights, and how long we take',
    [
      'Vietnamese law gives you the right to know what is done with your data; to give consent and to withdraw it; to access your data and receive a copy; to correct it; to delete it; to restrict processing; to object to processing, including processing carried out automatically; to be told who your data has been shared with; to complain to the authorities and to take legal action; and to claim compensation for a violation.',
      `You do not have to ask us for the two most common ones: your account settings let you export your data and delete your account yourself, at any time. For anything else, write to ${COMPANY.privacyEmail} from the email address or phone number linked to your account so we can be sure it is you.`,
      'The law sets the clocks and we work to them. We acknowledge a request within 2 working days. We provide access, or a copy of your data, within 10 days. We act on a withdrawal of consent, a restriction, or an objection within 15 days. We delete data within 20 days. Each of those periods may be extended once where a request is genuinely complex — if we need to extend one, we will tell you before the original period runs out, and why.',
      'Deleting your account removes your profile, your listings and your personal identifiers from the live service, and they fall out of backups as those backups roll over. What we keep after that is only what the law obliges us to keep — for example transaction records and reports already made to state authorities.',
      'If you think we have mishandled your data, tell us and we will look into it. You can also complain to the Ministry of Public Security (Department of Cybersecurity and High-Tech Crime Prevention, A05) at any point. You are not required to come to us first.',
    ],
  ],
  [
    'retention',
    'How long we keep your data',
    [
      'We keep personal data only while the purpose it was collected for still exists, and delete it when that purpose is fulfilled. Different data therefore has different lifetimes: account data lasts as long as your account; messages are kept while they are still a useful record for both sides and for resolving a report; e-commerce records are kept for the minimum period Vietnamese law requires (at least 3 years); records of consent are kept as evidence of what you agreed to and when you withdrew it.',
      ...(IS_SERVICES ? PRIVACY_SERVICES_RETENTION : []),
      'We publish this as a principle rather than a table of exact day counts, because those counts live in the systems that apply them and a number printed here would be wrong the first time one changed. If you want to know how long a specific piece of your data will be kept, ask us and we will tell you.',
    ],
  ],
  [
    'security',
    'Security, and what happens if there is a breach',
    [
      'Data travels over encrypted connections. Files that are not meant to be public are held in private storage that cannot be reached from the internet and is opened only through short-lived links issued to people entitled to see them. Sensitive payloads are stored encrypted. Access is limited to the people whose role needs it, and rate limits and abuse controls run on every sensitive endpoint.',
      'If a breach affects personal data, we notify the Ministry of Public Security within 72 hours of becoming aware of it, as the law requires — with what we know at the time, and the rest as we learn it. We notify you directly whenever the law requires it, and whenever the risk to you is real even if the obligation is arguable.',
    ],
  ],
  [
    'children',
    'Children',
    [
      'This service is for adults (18 and over). We do not knowingly process the data of a child under 16. The law would require a parent’s or guardian’s verified consent for that, and we do not seek it, because children should not be using the service at all. If you believe a child has an account, tell us and we will remove it.',
    ],
  ],
  [
    'changes',
    'Changes to this policy, and how to reach us',
    [
      `We may update this policy. Material changes are announced on the platform at least 5 days before they take effect, so you have time to read them and to object or withdraw consent before they apply. Questions, or anything at all about your personal data: ${COMPANY.privacyEmail}.`,
    ],
  ],
]

export default function PrivacyPage() {
  return (
    <ContentPage
      eyebrow="Legal"
      title="Privacy Policy"
      meta={
        <>
          <p className="mt-3 text-sm text-ink-4"><Tr text="Last updated: August 2026" /></p>
          <p className="mt-2 max-w-3xl text-xs text-muted-foreground italic"><Tr text="This translation is provided for your convenience. The English version of this policy is the authoritative one." /></p>
        </>
      }
      sections={baseSections.map(([id, title]) => ({ id, label: title }))}
    >
      {baseSections.map(([id, title, paras]) => (
        <ContentSection key={id} id={id} title={title}>
          <div className="space-y-2">
            {paras.map((p, j) => (
              <p key={j} className="text-base leading-relaxed text-body"><Tr text={p} /></p>
            ))}
          </div>
        </ContentSection>
      ))}
      <div className="pt-2">
        <CookieSettingsButton />
      </div>
    </ContentPage>
  )
}
