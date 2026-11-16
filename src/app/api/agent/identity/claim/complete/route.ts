import { rateLimit } from '@/lib/ratelimit'
import { logError } from '@/lib/log'
import { answerOf, completeClaim, denyClaim, emailHash, openAttempt } from '@/lib/api/agent-auth'
import { consumeAgentTicket, eligibleShop, openAgentTicket, releaseAgentTicket, verifiedPerson } from '@/lib/api/oauth-grant'
import { backToPage, sameOrigin } from '../../http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/agent/identity/claim/complete — /oauth/agent's Allow / Cancel (auth.md's claim "complete").
 * ⛔ EVERY CHECK AGAIN, ON THIS REQUEST, as /api/oauth/authorize does: same origin, the sealed ticket (unexpired, this
 * site's), the person confirmed by the auth server and equal to the ticket's, their confirmed email still the one the
 * agent registered with, the attempt still open, the shop still theirs and eligible. One answer per ticket.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return new Response('Cross-site request refused.\n\nYêu cầu từ trang khác bị từ chối.', { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  const person = await verifiedPerson()
  if (!person) return backToPage(req, {})
  if (!person.email) return backToPage(req, { e: 'email' })
  const rl = await rateLimit('agent-claim-answer', person.profileId, 20, '1 m')
  if (!rl.success) return backToPage(req, { e: 'tries' })
  let form: FormData
  try { form = await req.formData() } catch { return backToPage(req, { e: 'expired' }) }
  const allow = form.get('allow'), deny = form.get('deny')
  const sealed = typeof allow === 'string' ? allow : typeof deny === 'string' ? deny : ''
  const now = Math.floor(Date.now() / 1000)
  const t = openAgentTicket(sealed, now)
  if (!t || t.pid !== person.profileId) return backToPage(req, { e: 'expired' })
  try {
    // A second press of the same screen (a double tap): the browser shows only the last answer, so it must be the first
    // press's outcome, never "no longer open" (commit gate, opus). The ticket is this person's, for this registration.
    const prior = await answerOf(t.reg)
    if (prior) return backToPage(req, { done: prior })
    const open = await openAttempt(t.reg, t.n, emailHash(person.email), now)
    if (!open) return backToPage(req, { e: 'expired' })
    if (typeof allow !== 'string') {
      if (!(await consumeAgentTicket(t))) return backToPage(req, { e: 'answered' })
      // An Allow from another tab may have answered first: then say so, never "Not connected" (commit gate, opus).
      return backToPage(req, (await denyClaim(open)) ? { done: 'denied' } : { e: 'answered' })
    }
    const elig = await eligibleShop(person.profileId)
    if (!elig.ok || elig.shop.id !== t.sid) return backToPage(req, { e: elig.ok ? 'no_shop' : elig.reason })
    if (!(await consumeAgentTicket(t))) return backToPage(req, { e: 'answered' })
    try {
      const done = await completeClaim(open, person.profileId, elig.shop.id, now)
      return backToPage(req, done ? { done: 'allowed' } : { e: 'answered' })
    } catch (e) {
      logError(e, { op: 'agent.claimComplete' })
      await releaseAgentTicket(t)
      return backToPage(req, { e: 'unavailable' })
    }
  } catch (e) {
    logError(e, { op: 'agent.claimAnswer' })
    return backToPage(req, { e: 'unavailable' })
  }
}
