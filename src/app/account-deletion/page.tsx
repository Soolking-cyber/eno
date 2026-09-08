import type { Metadata } from 'next'
import { SITE_NAME } from '@/lib/edition'
import { Tr } from '@/context/language-context'
import { ContentPage, ContentSection } from '@/components/marketplace/content-page'
import { COMPANY } from '@/lib/site-legal'

export const metadata: Metadata = {
  title: `Delete your account | ${SITE_NAME}`,
  description: `How to delete your ${SITE_NAME} account and the personal data attached to it — in the app, or by written request.`,
  alternates: { canonical: '/account-deletion' },
}

/**
 * ACCOUNT + DATA DELETION — A PUBLIC PAGE, REACHABLE WITHOUT THE APP.
 *
 * ⛔ THIS EXISTS FOR A REQUIREMENT, NOT FOR TIDINESS. Google Play's Data safety form has a required
 * "account deletion" URL, and the policy behind it is explicit that the page must be reachable by
 * someone who has NOT installed the app and is not signed in — the point is that uninstalling must
 * not be the only way out. Deletion already worked in two places (Settings → Delete account, and by
 * written request under the privacy policy) but neither is a URL that can be pasted into that field:
 * one is behind a sign-in wall, the other is a paragraph inside a long policy. A reviewer who cannot
 * find the mechanism treats it as absent.
 *
 * ⚠️ IT DESCRIBES, IT DOES NOT DELETE. There is deliberately no "delete" button here: this page is
 * public and unauthenticated, so anything actionable on it would be a way to act on an account you
 * are not signed in to. The self-service path is /dashboard/settings, behind auth, where the real
 * control lives (src/components/marketplace/delete-account.tsx → /api/account/delete).
 *
 * ⚠️ BOTH EDITIONS SERVE THIS, and the contact address is per-edition — COMPANY carries
 * support@eno.vn on the marketplace and support@eno.forum on the services build. A hardcoded address
 * here would print the wrong entity's inbox on one of the two sites.
 *
 * ⚠️ WHAT IT SAYS ABOUT RETENTION MUST STAY TRUE. It names no number of days for how long anything
 * is kept, for the same reason the privacy policy names none: that lives in the data and changes
 * without this file being touched. The statutory RESPONSE clock (20 days, PDPL 91/2025) is fixed by
 * law and safe to print. The carve-out for records we must keep is real — see the erasure queue and
 * the payment/audit retention rules — and stating it here is what keeps the promise honest.
 */

const SECTIONS: [id: string, title: string, paras: string[]][] = [
  [
    'in-app',
    'Delete it yourself, in the app',
    [
      'Open the app or the website and sign in, then go to Dashboard → Settings. At the bottom of that page you will find "Delete account". It asks you to confirm, and then it runs immediately — you do not need to contact us and you do not need to wait for approval.',
      'This is the fastest route and the one we recommend. The same screen also lets you export a copy of your data first, which is worth doing before you delete anything, because deletion cannot be undone.',
    ],
  ],
  [
    'by-request',
    'Or ask us in writing',
    [
      'If you cannot sign in — a lost phone, a number you no longer use, an email address you no longer control — write to us and we will do it for you.',
      'Send the request from the email address or phone number linked to the account, so that we can tell it is yours. If you cannot do that either, tell us what you can about the account and we will ask you for whatever else we need to be certain before we delete anything. We will not delete an account on the word of someone who cannot show it is theirs; that protects you.',
      'We act on a deletion request within 20 days, the period set by Vietnam’s Personal Data Protection Law 91/2025. If a request is genuinely complex we may extend that once, and we will tell you if we do.',
    ],
  ],
  [
    'what-goes',
    'What is deleted',
    [
      'Your account and the profile attached to it, your listings, your saved items and searches, your messages, and any identity documents you uploaded for verification. Photographs you uploaded are removed from storage, not merely hidden.',
      'Some records survive, and we would rather say so plainly than leave you to discover it. Where the law requires us to keep something — an invoice or a payment record, or evidence in a dispute or a fraud case that is still open — that record is kept for as long as the law requires and no longer, and it is separated from your profile. Messages you sent to another person remain in that person’s copy of the conversation, because their record of a conversation is theirs and is not ours to erase.',
    ],
  ],
]

export default function AccountDeletionPage() {
  return (
    <ContentPage
      title="Delete your account"
      meta={<p className="mt-3 text-sm text-ink-4"><Tr text="Last updated: September 2026" /></p>}
      intro={<Tr text="You can delete your account and the personal data attached to it at any time, either yourself in the app or by asking us. This page explains both, and what happens afterwards." />}
      /* ⚠️ THE CONTACT SECTION IS IN THE RAIL TOO. It is rendered separately from SECTIONS (it
         carries a mailto link rather than plain paragraphs), and building the rail from SECTIONS
         alone left the written-request address — the whole point of this page for someone who
         cannot sign in — out of the page's own index. */
      sections={[...SECTIONS.map(([id, title]) => ({ id, label: title })), { id: 'contact', label: 'Where to write' }]}
    >
      {SECTIONS.map(([id, title, paras]) => (
        <ContentSection key={id} id={id} title={title}>
          <div className="space-y-2">
            {paras.map((p, j) => (
              <p key={j} className="text-base leading-relaxed text-body"><Tr text={p} /></p>
            ))}
          </div>
        </ContentSection>
      ))}
      <ContentSection id="contact" title="Where to write">
        <p className="text-base leading-relaxed text-body">
          <Tr text="Deletion requests and any question about your data go to" />{' '}
          <a className="underline underline-offset-2" href={`mailto:${COMPANY.privacyEmail}`}>{COMPANY.privacyEmail}</a>.
        </p>
      </ContentSection>
    </ContentPage>
  )
}
