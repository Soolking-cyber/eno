import 'server-only'
import { after } from 'next/server'
import { db } from '@/lib/db'
import { SITE_NAME } from '@/lib/edition'
import { sendMail } from '@/lib/mail'
import { sendPushToProfile } from '@/lib/push'
import { identityMarkState, type IdentityMarkState } from '@/lib/teachers/identity-mark'
import { identityRejectionSentence, renderIdentityOutcomeEmail, teacherMarkSentence, type TeacherMarkLine } from '@/lib/emails/identity-verification'

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
 * ⚖️ A TEACHER'S APPROVAL TELLS THEM ABOUT "IDENTITY VERIFIED" (owner, 2026-10-15; AUTOMATIC since 2026-10-16): the
 * account with a teacher profile hears, in the bell, the push and the email alike — one sentence, the email module's
 * (teacherMarkSentence) — either that the mark now shows on their profile and can be hidden there (the name within the
 * ID — src/lib/teachers/identity-mark.ts, judged LIVE: the approval's recompute has already run, so this is current),
 * that they HID it and can show it again, or that the NAME holds it back (the form says why) — chosen by teacherMarkLine
 * from the very reason Photo & publish shows — and every one of the three links to the switch
 * (/teachers/edit?step=finish), ⛔ never to the verify flow. A failed read says nothing about the mark (below).
 * A refusal, and every account without a teacher profile, is told exactly what it was told before.
 */
/**
 * What a teacher's approval says about "Identity verified" — from the REASON the form itself shows (identity-mark.ts
 * identityMarkStateOf: identity, then name, then the profile, then the teacher's hide), never from a yes/no (commit
 * gate, 2026-10-16: a boolean told a teacher whose NAME held the mark back to "switch it on"):
 *   · shown → 'now' ("now shows — you can hide it")
 *   · held back only by the teacher's own hide → 'can' ("you have hidden it — you can show it again")
 *   · held back by the NAME — none on the ID, or not within it — hidden or not → 'notYet' ("see why")
 *   · an identity-side reason (the approval raced a revocation, say), or no profile → null: nothing about the mark
 */
export function teacherMarkLine(s: IdentityMarkState): TeacherMarkLine | null {
  if (s.shown) return 'now'
  if (s.reason === 'hidden') return 'can'
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
      // The teacher profile's three mark inputs (the name and the hide's two columns) — read for the one line below, never
      // sent anywhere.
      select: { email: true, locale: true, teacherProfile: { select: { fullName: true, identityMarkOn: true, identityMarkWithdrawnAt: true, status: true, listing: { select: { status: true, verified: true } } } } },
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
      ? await identityMarkState({ profileId, fullName: tp.fullName, identityMarkOn: tp.identityMarkOn, identityMarkWithdrawnAt: tp.identityMarkWithdrawnAt }, new Date())
        .catch(() => null)
      : null
    // ⛔ A FAILED READ SAYS NOTHING ABOUT THE MARK (commit gate, 2026-10-16): "now shows", "not yet" and "you have hidden
    // it" are all unknown — the plain approval and the hub, as for any account.
    // ⛔ "NOW SHOWS" ONLY ON A PROFILE THE PUBLIC CAN SEE (commit gate, opus round 3): the mark's rule never looks at the
    // profile's own visibility, so a teacher whose profile is hidden (or not yet published to the feed — the same rule as
    // GET /api/teachers/me `listingLive`) would be told it shows where nobody sees it. Then: the plain approval and the hub.
    const live = tp?.status === 'live' && tp.listing?.status === 'active' && tp.listing.verified === true
    const raw = mark ? teacherMarkLine(mark) : null
    const line = raw === 'now' && !live ? null : raw
    const teacher = line ? { line } : null
    // Where all three channels lead: a teacher to the switch (Photo & publish), never the verify flow; everyone else the hub.
    const url = teacher ? '/teachers/edit?step=finish' : '/dashboard/verification'

    const title = approved
      ? (lang === 'vi' ? 'Danh tính đã được xác minh' : 'Your identity is verified')
      : (lang === 'vi' ? 'Xác minh danh tính chưa được chấp nhận' : 'Identity verification not accepted')
    const bellBody = teacher
      ? teacherMarkSentence(lang, teacher.line)
      : approved
        // Not "ever again": a document that expires, or is replaced, is verified again (the email says the same).
        ? (lang === 'vi' ? 'Bạn sẽ không phải làm lại bước này trừ khi giấy tờ hết hạn hoặc được thay mới.' : 'You will not be asked to do this again unless your document expires or is replaced.')
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
