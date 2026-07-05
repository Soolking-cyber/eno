import type { Metadata } from 'next'
import { Tr } from '@/context/language-context'
import { ContentPage, ContentSection } from '@/components/marketplace/content-page'

export const metadata: Metadata = { title: 'Privacy Policy | eno.vn' }

const sections: [string, string[]][] = [
  [
    'Overview',
    [
      'eno.vn ("we", "us") operates a verified classifieds marketplace for people living in and visiting Vietnam. This policy explains what personal information we collect, how we use it, and the choices you have. By using eno.vn you agree to this policy.',
    ],
  ],
  [
    'Information we collect',
    [
      'Account information: when you sign in we receive your email address and/or phone number, and — if you use Google sign-in — your name and profile picture from Google.',
      'Listing information: the title, description, price, photos, location and contact phone number you choose to include when you post a listing.',
      'Usage information: basic technical data such as device type, language preference and pages viewed, used to operate and improve the service.',
    ],
  ],
  [
    'How we use your information',
    [
      'To create and secure your account and let you sign in.',
      'To publish your listings, after our verification review, and connect buyers with sellers.',
      'To verify listings, prevent fraud and abuse, and keep the marketplace trustworthy.',
      'To translate listing and interface content into your chosen language.',
      'To respond to reports, questions and support requests.',
    ],
  ],
  [
    'Service providers we share data with',
    [
      'We use trusted providers strictly to run eno.vn, and we do not sell your personal information. These include: Supabase (authentication, database and image storage); Google (sign-in if you choose it, and Google Analytics for aggregate usage measurement); Microsoft Azure Translator (to translate content — message text is processed and not retained by the provider for training); and SMS/Zalo messaging providers (to deliver one-time login codes).',
    ],
  ],
  [
    'Cookies and local storage',
    [
      'We use a secure session cookie to keep you signed in, and your browser’s local storage to remember your language choice and saved listings. We do not use third-party advertising trackers.',
    ],
  ],
  [
    'Your choices and rights',
    [
      'You can view and update your account details, and request deletion of your account and listings, at any time by contacting support@eno.vn. We retain information only as long as needed to provide the service or meet legal obligations.',
    ],
  ],
  [
    'Security',
    [
      'We use industry-standard measures to protect your data, including encrypted connections and access controls. No system is perfectly secure, so please use a strong, unique sign-in method and never share one-time codes.',
    ],
  ],
  [
    'Children',
    ['eno.vn is intended for adults (18+) and is not directed at children.'],
  ],
  [
    'Changes and contact',
    [
      'We may update this policy from time to time; material changes will be reflected on this page. Questions about privacy? Email support@eno.vn.',
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
          <p className="mt-3 text-sm text-ink-4"><Tr text="Last updated: June 2026" /></p>
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
