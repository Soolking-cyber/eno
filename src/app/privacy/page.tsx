import type { Metadata } from 'next'
import { Tr } from '@/context/language-context'
import { ContentPage, ContentSection } from '@/components/marketplace/content-page'
import { COMPANY } from '@/lib/site-legal'

export const metadata: Metadata = { title: 'Privacy Policy | eno.vn' }

// ── Privacy policy — written to the Personal Data Protection Law 91/2025/QH15 +
// Decree 356/2025 (compliance audit 2026-07-06): controller identity, per-purpose
// processing, sensitive-data notice, cross-border disclosure, rights + statutory
// response times, consent withdrawal, children. Keep in sync with the consent
// banner tiers (src/lib/consent.ts) and the trackers actually wired.

const sections: [string, string[]][] = [
  [
    'Overview & who is responsible',
    [
      'eno.vn ("we", "us") operates a classifieds marketplace for people living in and visiting Vietnam. This policy explains what personal data we process, why, who it goes to, and the rights Vietnamese law gives you (Personal Data Protection Law 91/2025/QH15).',
      `The data controller is ${COMPANY.name}, ${COMPANY.address}. Contact for all privacy matters: ${COMPANY.privacyEmail}. We acknowledge privacy requests within 2 working days.`,
    ],
  ],
  [
    'Information we collect',
    [
      'Account information: when you sign in we receive your email address and/or phone number, and — if you use Google sign-in — your name and profile picture from Google.',
      'Listing information: the title, description, price, photos, location and contact phone number you choose to include when you post a listing.',
      'Messages: conversations you have with other users through the on-platform chat (kept so both sides have a record and so reports of fraud or abuse can be reviewed fairly).',
      'Usage information: device type, language preference, pages viewed and on-site activity such as searches and listing views. Some of this — behavioral activity and precise location if you share it for map features — is classified as sensitive personal data under Vietnamese law, and we treat it accordingly: it is processed only for the purposes below and, for analytics or advertising uses, only with your explicit consent.',
    ],
  ],
  [
    'How we use your information',
    [
      'To create and secure your account and let you sign in.',
      'To publish your listings after automated checks and connect buyers with sellers.',
      'To prevent fraud and abuse, run the trust-score system, and keep the marketplace safe.',
      'To translate listing and interface content into your chosen language.',
      'To respond to reports, questions and support requests.',
      'With your consent only: to measure the service with analytics and to send conversion signals to advertising platforms (see Cookies & tracking below).',
    ],
  ],
  [
    'Service providers & international transfers',
    [
      'We use trusted providers strictly to run eno.vn, and we never sell your personal data (Vietnamese law prohibits trading in personal data, and so do we). Providers: Supabase (authentication, database and image storage), Vercel (hosting), Google (sign-in if you choose it, translation, AI-powered search, and — with your consent — Google Analytics), Meta (with your consent — conversion measurement), Microsoft Azure Translator (content translation, not retained for training), and messaging providers (Telegram, WhatsApp, Zalo, SMS) that deliver one-time login codes.',
      'Several of these providers process data on servers outside Vietnam (primarily Singapore). Under Vietnamese law this is a cross-border data transfer: we document these transfers, maintain data-transfer agreements with the providers, and file the required transfer impact assessments with the Ministry of Public Security.',
    ],
  ],
  [
    'Cookies & tracking',
    [
      'Essential storage keeps you signed in and remembers your language and saved listings — it always works and tracks nothing about you across other sites.',
      'Analytics and advertising trackers (Google Analytics; Meta conversion signals, including ones sent from our server) run ONLY if you choose "Allow all" in the cookie banner. If you decline, no third-party tracking runs — including server-side. You can change your choice any time in the cookie settings, and withdrawing consent stops the trackers immediately.',
      'On-site personalization (the "For You" row using your own eno.vn activity) stays on our servers, never leaves us, and can be switched off by choosing "Essential only".',
    ],
  ],
  [
    'Your rights',
    [
      'Vietnamese law gives you the right to know, consent to, access, correct, restrict, object to, and delete your personal data, to withdraw consent, to complain, and to claim damages for violations.',
      `To exercise any of these, email ${COMPANY.privacyEmail} from the address or phone linked to your account. We acknowledge within 2 working days; access and copies are provided within 10 days; consent withdrawal and restriction are implemented within 15 days; deletion within 20 days. Deleting your account removes your profile, listings and personal identifiers from the live service and, on the statutory schedule, from backups — except records we must keep by law (for example transaction reports to authorities).`,
      'If you believe we have mishandled your data you can also complain to the Ministry of Public Security (A05).',
    ],
  ],
  [
    'Retention & security',
    [
      'We keep personal data only as long as needed for the purposes above or as Vietnamese law requires (e-commerce records must be kept at least 3 years). We use encrypted connections, access controls and least-privilege infrastructure. If a breach affecting your data occurs, we notify the authorities within 72 hours as required, and we tell you when the law requires it or the risk to you is significant.',
    ],
  ],
  [
    'Children',
    [
      'eno.vn is for adults (18+). We do not knowingly process data of children under 16; if you believe a child is using the service, tell us and we will remove the account.',
    ],
  ],
  [
    'Changes and contact',
    [
      `We may update this policy; material changes are announced on the platform at least 5 days before they take effect. Questions about privacy? Email ${COMPANY.privacyEmail}.`,
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
          <p className="mt-3 text-sm text-ink-4"><Tr text="Last updated: July 2026" /></p>
          <p className="mt-2 max-w-3xl text-xs text-muted-foreground italic"><Tr text="This translation is provided for your convenience. The English version of this policy is the authoritative one." /></p>
        </>
      }
      sections={sections.map(([title], i) => ({ id: `s${i}`, label: title as string }))}
    >
      {sections.map(([title, paras], i) => (
        <ContentSection key={i} id={`s${i}`} title={title as string}>
          <div className="space-y-2">
            {(paras as string[]).map((p, j) => (
              <p key={j} className="text-[15px] leading-relaxed text-body"><Tr text={p} /></p>
            ))}
          </div>
        </ContentSection>
      ))}
    </ContentPage>
  )
}
