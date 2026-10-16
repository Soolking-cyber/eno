import 'server-only'
import { after } from 'next/server'
import { db } from '@/lib/db'
import { SITE_NAME } from '@/lib/edition'
import { sendMail } from '@/lib/mail'
import { sendPushToProfile } from '@/lib/push'
import { identityMarkState, type IdentityMarkState } from '@/lib/teachers/identity-mark'
import { identityRejectionSentence, renderIdentityOutcomeEmail, type TeacherMarkLine } from '@/lib/emails/identity-verification'

/**
 * TELL THE SELLER WHAT THE REVIEWER DECIDED — bell, push and email.
 *
 * ⛔ THIS DID NOT EXIST. Six places in the product — the verify page, the verification hub, the
 * publish gate, and their native twins — told the seller "we will email you the result", and
 * nothing did: `reviewKycCase` wrote the decision to the row and told nobody. A foreign seller who
 * photographed their passport waited for an email that was never going to arrive, and one whose
 * case was refused never learned the reviewer's reason, which was recorded on the case as
 * `evidence.reviewerNote` and shown to no one. The business-verification flow had the identical
 * hole (owner, 2026-08-17) and the identical fix; this mirrors `notifyVerificationOutcome`.
 *
 * ⚠️ THREE INDEPENDENT CHANNELS, NOT ONE CHAIN. Each fails alone: a dead push subscription must not
 * cost the seller the email, and a bell row that could not be written must not cost them either.
 *
 * ⚠️ THE EMAIL IS IN ONE LANGUAGE — the profile's locale, English by default. Unlike the payout
 * security alert this is not a message where a wrong guess costs money, and a bilingual wall makes
 * a two-sentence outcome hard to read. The hub the CTA opens is bilingual regardless.
 *
 * ⚖️ A TEACHER'S APPROVAL TELLS THEM ABOUT "IDENTITY VERIFIED" (owner, 2026-10-15): the account with a teacher profile
 * hears, in the bell, the push and the email alike, either that the mark now shows on their profile (switched on under
 * today's notice, the name within the ID — src/lib/teachers/identity-mark.ts, judged LIVE: the approval's recompute has
 * already run, so this is current), that the NAME holds it back (the form says why), or that only the switch does —
 * chosen by teacherMarkLine from the very reason Photo & publish shows — and every one of the three links to the switch
 * (/teachers/edit?step=finish), ⛔ never to the verify flow. A failed read says nothing about the mark (below).
 * A refusal, and every account without a teacher profile, is told exactly what it was told before.
 */
/**
 * What a teacher's approval says about "Identity verified" — from the REASON the form itself shows (identity-mark.ts
 * identityMarkStateOf: identity, then name, then switch), never from a yes/no (commit gate, 2026-10-16: a boolean told
 * a teacher whose NAME held the mark back to "switch it on"):
 *   · shown → 'now'
 *   · held back only by the switch — off, or on under an older notice → 'can' ("switch it on")
 *   · held back by the NAME — none on the ID, or not within it — switch on or off → 'notYet' ("see why")
 *   · an identity-side reason (the approval raced a revocation, say) → null: nothing about the mark
 */
export function teacherMarkLine(s: IdentityMarkState): TeacherMarkLine | null {
  if (s.shown) return 'now'
  if (s.reason === 'off' || s.reason === 'notice_changed') return 'can'
  if (s.reason === 'no_name' || s.reason === 'name_mismatch') return 'notYet'
  return null
}

/** A bell body is short; a cut is shown as a cut, on a word boundary where there is one. */
function clip(text: string | null, max: number): string | null {
  if (!text) return null
  if (text.length <= max) return text
  const head = text.slice(0, max - 1)
  const space = head.lastIndexOf(' ')
  return `${space > max / 2 ? head.slice(0, space) : head}…`
}

export async function notifyIdentityOutcome(
  profileId: string,
  outcome: 'approved' | 'rejected',
  detail: { reason: string | null; note: string | null; tier: 'A' | 'B' },
): Promise<void> {
  try {
    const profile = await db.profile.findUnique({
      where: { id: profileId },
      // The teacher profile's three mark inputs — read for one boolean (`markShown`), never sent anywhere.
      select: { email: true, locale: true, teacherProfile: { select: { fullName: true, identityMarkOn: true, identityMarkNoticeVersion: true } } },
    })
    // ⚠️ NO STORED LOCALE: a CCCD holder is a Vietnamese citizen, so tier A defaults to Vietnamese;
    // a passport holder to English. A stored preference always wins.
    const lang: 'en' | 'vi' = profile?.locale
      ? (profile.locale.startsWith('vi') ? 'vi' : 'en')
      : (detail.tier === 'A' ? 'vi' : 'en')
    const approved = outcome === 'approved'
    const why = approved ? null : identityRejectionSentence(lang, detail.reason, detail.note)
    // A teacher's approval (above): what the mark does now, judged as the form judges it.
    const tp = approved ? profile?.teacherProfile ?? null : null
    const mark = tp
      ? await identityMarkState({ profileId, fullName: tp.fullName, identityMarkOn: tp.identityMarkOn, identityMarkNoticeVersion: tp.identityMarkNoticeVersion }, new Date())
        .catch(() => null)
      : null
    // ⛔ A FAILED READ SAYS NOTHING ABOUT THE MARK (commit gate, 2026-10-16): "now shows", "not yet" and "switch it on" are
    // all unknown — the plain approval and the hub, as for any account.
    const line = mark ? teacherMarkLine(mark) : null
    const teacher = line ? { line } : null
    // Where all three channels lead: a teacher to the switch (Photo & publish), never the verify flow; everyone else the hub.
    const url = teacher ? '/teachers/edit?step=finish' : '/dashboard/verification'

    const title = approved
      ? (lang === 'vi' ? 'Danh tính đã được xác minh' : 'Your identity is verified')
      : (lang === 'vi' ? 'Xác minh danh tính chưa được chấp nhận' : 'Identity verification not accepted')
    const bellBody = teacher
      ? (teacher.line === 'now'
        ? (lang === 'vi' ? 'Nhãn “Đã xác minh danh tính” đã hiển thị trên hồ sơ giáo viên của bạn.' : '“Identity verified” now shows on your teacher profile.')
        : teacher.line === 'notYet'
          ? (lang === 'vi' ? 'Nhãn “Đã xác minh danh tính” chưa hiển thị trên hồ sơ giáo viên của bạn — xem lý do trong bước Ảnh & đăng.' : '“Identity verified” is not showing on your teacher profile yet — see why in Photo & publish.')
          : (lang === 'vi' ? 'Giờ bạn có thể hiển thị “Đã xác minh danh tính” trên hồ sơ giáo viên — bật trong bước Ảnh & đăng.' : 'You can now show “Identity verified” on your teacher profile — switch it on in Photo & publish.'))
      : approved
        ? (lang === 'vi' ? 'Bạn sẽ không phải làm lại bước này.' : 'You will not be asked to do this again.')
        : (clip(why, 140) || (lang === 'vi' ? 'Nhân viên chưa thể chấp nhận giấy tờ của bạn.' : 'A reviewer could not accept your documents.'))
    /**
     * ⚠️ THE PUSH NEVER CARRIES THE REVIEWER'S NOTE. It transits a third-party push service and lands
     * on a lock screen; the note can name a document number or a mismatch in a legal name. "Open
     * verification to see why" is enough to make someone open the app, which is all a push must do.
     */
    const pushBody = approved
      ? bellBody
      : (lang === 'vi' ? 'Mở phần xác minh để xem lý do.' : 'Open verification to see why.')

    try {
      await db.notification.create({
        // `verification`, not `system`: a refusal's body is the reviewer's note, and the bell machine-translates `system`
        // rows — this type is shown as written (src/lib/notification-text.ts). Same seal and line-clamp in the bell.
        data: { recipientId: profileId, type: 'verification', title, body: bellBody, actorName: SITE_NAME, url },
      })
    } catch (e) {
      console.error('[identity] bell', (e as Error).message)
    }

    const to = profile?.email
    const deliver = async () => {
      try {
        await sendPushToProfile(profileId, { title, body: pushBody, url, tag: `identity-${profileId}` })
      } catch { /* a dead push subscription is not a review failure */ }
      if (!to) return
      try {
        const origin = process.env.NEXT_PUBLIC_APP_URL || `https://${SITE_NAME}`
        const mail = renderIdentityOutcomeEmail({ outcome, reason: detail.reason, note: detail.note, tier: detail.tier, lang, origin, siteName: SITE_NAME, teacher })
        // ⚠️ `sendMail` returns false on a provider refusal rather than throwing — say so.
        const sent = await sendMail({ to, subject: mail.subject, html: mail.html, text: mail.text })
        if (!sent) console.error('[identity] outcome email not sent', { profileId, outcome })
      } catch (e) {
        console.error('[identity] outcome email', (e as Error).message)
      }
    }

    // ⚠️ `after()` THROWS OUTSIDE A REQUEST SCOPE (a script, a test, a cron). In a request we defer
    // so the admin's click is not held on SMTP; outside one we simply await.
    try {
      after(deliver)
    } catch {
      await deliver()
    }
  } catch (e) {
    console.error('[identity] notify outcome', (e as Error).message)
  }
}
