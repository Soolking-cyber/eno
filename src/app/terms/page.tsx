import type { Metadata } from 'next'
import { Tr } from '@/context/language-context'
import { ContentPage, ContentSection } from '@/components/marketplace/content-page'

export const metadata: Metadata = { title: 'Terms of Service | eno.vn' }

const sections: [string, string[]][] = [
  [
    'Acceptance',
    [
      'These Terms govern your use of eno.vn, a verified classifieds marketplace. By accessing or using eno.vn you agree to these Terms. If you do not agree, please do not use the service.',
    ],
  ],
  [
    'Eligibility and accounts',
    [
      'You must be at least 18 years old to use eno.vn. You are responsible for keeping your sign-in method secure and for all activity under your account. Never share one-time login codes with anyone.',
    ],
  ],
  [
    'Listings and conduct',
    [
      'You are solely responsible for the accuracy and legality of the listings and content you post. You agree to provide truthful information and real photos, and to honour the prices you advertise.',
      'You may not post illegal, counterfeit, stolen, unsafe or prohibited items, nor engage in scams, bait pricing, harassment, spam, or any unlawful activity. We may remove listings and suspend accounts that violate these Terms.',
    ],
  ],
  [
    'Trust & moderation',
    [
      'Listings publish after automated checks, and every seller carries a trust score earned from verified activity, reviews, and confirmed reports. Trust badges reduce risk but are not a guarantee or endorsement, and do not make eno.vn a party to any transaction. Always inspect items and meet safely.',
    ],
  ],
  [
    'eno.vn is a platform, not a party to transactions',
    [
      'eno.vn provides a venue to discover listings and contact sellers. We are not the buyer or seller, do not take payment for listed items, and are not responsible for the quality, safety, legality, or delivery of items, or for the conduct of users. Transactions are solely between buyer and seller.',
    ],
  ],
  [
    'Your content',
    [
      'You retain ownership of the content you post. By posting, you grant eno.vn a non-exclusive, worldwide licence to host, display, translate and distribute that content for the purpose of operating and promoting the marketplace.',
    ],
  ],
  [
    'Disclaimers and limitation of liability',
    [
      'eno.vn is provided "as is" without warranties of any kind. To the maximum extent permitted by law, eno.vn is not liable for any indirect, incidental or consequential damages, or for losses arising from transactions between users.',
    ],
  ],
  [
    'Termination',
    [
      'We may suspend or terminate access for any violation of these Terms or to protect users and the service. You may stop using eno.vn and request account deletion at any time.',
    ],
  ],
  [
    'Changes and contact',
    [
      'We may update these Terms from time to time; continued use after changes means you accept them. Questions? Email support@eno.vn.',
    ],
  ],
]

export default function TermsPage() {
  return (
    <ContentPage
      eyebrow="Legal"
      title="Terms of Service"
      meta={
        <>
          <p className="mt-3 text-sm text-ink-4"><Tr text="Last updated: June 2026" /></p>
          <p className="mt-2 max-w-3xl text-xs text-muted-foreground italic"><Tr text="This translation is provided for your convenience. The English version of these terms is the authoritative one." /></p>
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
