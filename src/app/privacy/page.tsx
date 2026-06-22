import type { Metadata } from 'next'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'

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
      'You can view and update your account details, and request deletion of your account and listings, at any time by contacting support@eno.forum. We retain information only as long as needed to provide the service or meet legal obligations.',
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
      'We may update this policy from time to time; material changes will be reflected on this page. Questions about privacy? Email support@eno.forum.',
    ],
  ],
]

export default function PrivacyPage() {
  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main className="flex-1 max-w-3xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-10 pb-16">
        <p className="eyebrow text-accent-foreground mb-2">Legal</p>
        <h1 className="h-display text-foreground">Privacy Policy</h1>
        <p className="mt-3 text-sm text-ink-4">Last updated: June 2026</p>
        <div className="mt-8 space-y-8">
          {sections.map(([title, paras], i) => (
            <section key={i}>
              <h2 className="h-section text-foreground mb-2">{title}</h2>
              <div className="space-y-2">
                {paras.map((p, j) => (
                  <p key={j} className="text-[15px] leading-relaxed text-body">{p}</p>
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>
      <Footer />
    </div>
  )
}
