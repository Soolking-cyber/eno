import type { Metadata } from 'next'
import Link from 'next/link'
import { SITE_NAME } from '@/lib/edition'
import { Tr } from '@/context/language-context'
import { Bilingual } from '@/components/marketplace/bilingual'
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
 * not be the only way out. Deletion already worked in two places (Settings → Account → Delete my account,
 * and by written request under the privacy policy) but neither is a URL that can be pasted into that field:
 * one is behind a sign-in wall, the other is a paragraph inside a long policy. A reviewer who cannot
 * find the mechanism treats it as absent.
 *
 * ⚠️ IT DESCRIBES, IT DOES NOT DELETE. There is deliberately no "delete" button here: this page is
 * public and unauthenticated, so anything actionable on it would be a way to act on an account you
 * are not signed in to. The self-service path is /dashboard/settings?tab=account, behind auth, where the
 * real control lives (src/components/marketplace/delete-account.tsx → /api/account/delete); the one link
 * here goes there, and that screen sends a signed-out visitor to sign in first. The account hub's name row
 * opens Settings on its Profile tab (where people edit their profile), so the steps name the Account tab.
 *
 * ⛔ THE STEPS QUOTE THE APP, LABEL FOR LABEL. They once said "Dashboard → Settings … at the bottom of
 * that page … 'Delete account'", and no such page or button existed (App Store audit 1.4, Guideline
 * 5.1.1(v): a reviewer who follows the steps and does not find the control treats deletion as missing).
 * The real path: the Account tab (mobile-nav.tsx) → the name/photo row at the top (account-client.tsx),
 * or on desktop the rail's identity card (account-panel-body.tsx) → Settings' Account tab
 * (settings-tabs.tsx) → "Danger zone" (settings-client.tsx) → "Delete my account" → DELETE →
 * "Permanently delete" (delete-account.tsx). Rename any of those and this page is wrong again —
 * page.test.tsx holds the quoted labels to the app's own tr() pairs. The Vietnamese is AUTHORED
 * (<Bilingual>) for the same reason: a machine translation would name buttons the app does not show.
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

/** A plain string goes through <Tr> (generated dictionary, else machine translation); a pair is authored. */
type Copy = string | { en: string; vi: string }

const SECTIONS: [id: string, title: string, paras: Copy[], link?: { href: string; en: string; vi: string }][] = [
  [
    'in-app',
    'Delete it yourself, in the app',
    [
      {
        en: 'Sign in to the app or the website, then open Settings. In the app or on a phone, tap Account (the person icon at the bottom right), then tap your name or photo at the top of that screen. On a computer, click your name or photo at the bottom of the menu on the left.',
        vi: 'Đăng nhập vào ứng dụng hoặc trang web, rồi mở Cài đặt. Trên ứng dụng hoặc điện thoại, chạm vào Tài khoản (biểu tượng hình người ở góc dưới bên phải), rồi chạm vào tên hoặc ảnh đại diện của bạn ở đầu màn hình đó. Trên máy tính, nhấp vào tên hoặc ảnh đại diện của bạn ở cuối thanh menu bên trái.',
      },
      {
        en: 'In Settings, open the Account tab and, under "Danger zone", select "Delete my account". Type DELETE to confirm and select "Permanently delete". Deletion then runs immediately — you do not need to contact us and you do not need to wait for approval. Only if your account has an open report or review does the screen say so and ask you to write to us instead.',
        vi: 'Trong Cài đặt, mở thẻ Tài khoản, rồi ở mục "Vùng nguy hiểm", chọn "Xóa tài khoản của tôi". Nhập DELETE để xác nhận và chọn "Xóa vĩnh viễn". Tài khoản sẽ bị xóa ngay lập tức — bạn không cần liên hệ với chúng tôi và cũng không cần chờ phê duyệt. Chỉ khi tài khoản của bạn đang có báo cáo hoặc đang được xem xét, màn hình sẽ thông báo và đề nghị bạn viết thư cho chúng tôi.',
      },
      'This is the fastest route and the one we recommend. The same screen also lets you export a copy of your data first, which is worth doing before you delete anything, because deletion cannot be undone.',
    ],
    { href: '/dashboard/settings?tab=account', en: 'Go straight to Settings → Account', vi: 'Mở ngay Cài đặt → Tài khoản' },
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
      meta={<p className="mt-3 text-sm text-ink-4"><Bilingual en="Last updated: October 2026" vi="Cập nhật lần cuối: Tháng 10 năm 2026" /></p>}
      intro={<Tr text="You can delete your account and the personal data attached to it at any time, either yourself in the app or by asking us. This page explains both, and what happens afterwards." />}
      /* ⚠️ THE CONTACT SECTION IS IN THE RAIL TOO. It is rendered separately from SECTIONS (it
         carries a mailto link rather than plain paragraphs), and building the rail from SECTIONS
         alone left the written-request address — the whole point of this page for someone who
         cannot sign in — out of the page's own index. */
      sections={[...SECTIONS.map(([id, title]) => ({ id, label: title })), { id: 'contact', label: 'Where to write' }]}
    >
      {SECTIONS.map(([id, title, paras, link]) => (
        <ContentSection key={id} id={id} title={title}>
          <div className="space-y-2">
            {paras.map((p, j) => (
              <p key={j} className="text-base leading-relaxed text-body">
                {typeof p === 'string' ? <Tr text={p} /> : <Bilingual en={p.en} vi={p.vi} />}
              </p>
            ))}
            {link && (
              <p className="text-base leading-relaxed text-body">
                <Link className="font-semibold underline underline-offset-2" href={link.href}><Bilingual en={link.en} vi={link.vi} /></Link>
              </p>
            )}
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
