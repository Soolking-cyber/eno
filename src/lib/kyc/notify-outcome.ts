import 'server-only'
import { after } from 'next/server'
import { db } from '@/lib/db'
import { SITE_NAME } from '@/lib/edition'
import { sendMail } from '@/lib/mail'
import { sendPushToProfile } from '@/lib/push'
import { identityRejectionSentence, renderIdentityOutcomeEmail } from '@/lib/emails/identity-verification'

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
 */
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
      select: { email: true, locale: true },
    })
    // ⚠️ NO STORED LOCALE: a CCCD holder is a Vietnamese citizen, so tier A defaults to Vietnamese;
    // a passport holder to English. A stored preference always wins.
    const lang: 'en' | 'vi' = profile?.locale
      ? (profile.locale.startsWith('vi') ? 'vi' : 'en')
      : (detail.tier === 'A' ? 'vi' : 'en')
    const approved = outcome === 'approved'
    const why = approved ? null : identityRejectionSentence(lang, detail.reason, detail.note)

    const title = approved
      ? (lang === 'vi' ? 'Danh tính đã được xác minh' : 'Your identity is verified')
      : (lang === 'vi' ? 'Xác minh danh tính chưa được chấp nhận' : 'Identity verification not accepted')
    const bellBody = approved
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
        data: { recipientId: profileId, type: 'system', title, body: bellBody, actorName: SITE_NAME, url: '/dashboard/verification' },
      })
    } catch (e) {
      console.error('[identity] bell', (e as Error).message)
    }

    const to = profile?.email
    const deliver = async () => {
      try {
        await sendPushToProfile(profileId, { title, body: pushBody, url: '/dashboard/verification', tag: `identity-${profileId}` })
      } catch { /* a dead push subscription is not a review failure */ }
      if (!to) return
      try {
        const origin = process.env.NEXT_PUBLIC_APP_URL || `https://${SITE_NAME}`
        const mail = renderIdentityOutcomeEmail({ outcome, reason: detail.reason, note: detail.note, tier: detail.tier, lang, origin, siteName: SITE_NAME })
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
