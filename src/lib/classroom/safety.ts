import 'server-only'
import { logError } from '@/lib/log'
import { sendMailOnce } from '@/lib/mail'
import type { AgeBand } from './limits'

/**
 * ⛔ A HARM FLAG REACHES A PERSON (2a reviews, opus + codex): every address in ADMIN_EMAILS gets a short alert — not a
 * word of what the learner said, only where to look — the moment a flagged turn is saved, and again (deduplicated by
 * Resend's idempotency key, so once in practice) when the session's report is built, so neither a lost process nor a
 * failed report can swallow it. Never throws: a mail failure is logged, and the flag itself is already in the database.
 */
export async function alertSafetyTeam(sessionId: string): Promise<void> {
  const to = (process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim()).filter(Boolean)
  // ⛔ Never silent (2a round 7, opus): with no address configured the flag is still in the database and on /admin/classroom
  // — and the server log says, loudly, that no person was told.
  if (!to.length) logError(new Error('classroom: a safety flag with no ADMIN_EMAILS to alert'), { op: 'classroom.safety.alert', sessionId })
  const link = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://eno.vn'}/admin/classroom`
  await Promise.all(to.map((addr, i) => sendMailOnce({
    to: addr,
    subject: 'eno Classroom: a session was flagged for a learner’s safety',
    text: `A learner mentioned harm or danger in an eno Classroom session.\n\nReview it (admins only): ${link}\nSession: ${sessionId}`,
    html: `<p>A learner mentioned harm or danger in an eno Classroom session.</p><p><a href="${link}">Review it on /admin/classroom</a> (admins only).</p><p>Session: ${sessionId}</p>`,
  }, { idempotencyKey: `classroom-safety-${sessionId}-${i}` }).catch((e) => logError(e, { op: 'classroom.safety.alert' }))))
}

/**
 * Our OWN words for a turn the model flagged for harm but whose reply could not be used (it carried a number, or broke a
 * rule): the flag must never be lost with the reply (2a round 5, opus), and the learner still hears something kind.
 * No phone numbers here — which helpline to name is a decision for eno, not for a model.
 */
export function safetyReply(band: AgeBand): string {
  return band === 'adult'
    ? 'Thank you for telling me. If you are in danger, please reach out to someone you trust or to local emergency services.'
    : 'Thank you for telling me. That sounds important. Please talk to a grown-up you trust, like a parent or a teacher.'
}
