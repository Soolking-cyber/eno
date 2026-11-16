import { rateLimit } from '@/lib/ratelimit'
import { logError } from '@/lib/log'
import { AGENT_TICKET_TTL_SECONDS, CODE_TRIES_PER_PROFILE, emailHash, lookupByCode } from '@/lib/api/agent-auth'
import { eligibleShop, issueAgentTicket, verifiedPerson } from '@/lib/api/oauth-grant'
import { backToPage, sameOrigin } from '../../http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/agent/identity/claim/lookup — /oauth/agent's code form. The code is looked up ONLY among the open attempts
 * made for the signed-in person's own confirmed email (agent-auth.ts lookupByCode), so a guess can only find a request
 * for the guesser's own account; tries are still capped per person. Found → back to the page with a sealed agent ticket
 * that shows what is asked; every answer is a 303 to /oauth/agent on this site.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return new Response('Cross-site request refused.\n\nYêu cầu từ trang khác bị từ chối.', { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  const person = await verifiedPerson()
  if (!person) return backToPage(req, {})
  if (!person.email) return backToPage(req, { e: 'email' })
  const rl = await rateLimit('agent-claim-code', person.profileId, CODE_TRIES_PER_PROFILE, '10 m')
  if (!rl.success) return backToPage(req, { e: 'tries' })
  let code = ''
  try { code = String((await req.formData()).get('user_code') ?? '').replace(/\s+/g, '') } catch { return backToPage(req, { e: 'code' }) }
  const now = Math.floor(Date.now() / 1000)
  try {
    const found = await lookupByCode(emailHash(person.email), code, now)
    if (!found) return backToPage(req, { e: 'code' })
    const elig = await eligibleShop(person.profileId)
    if (!elig.ok) return backToPage(req, { e: elig.reason })
    const ticket = issueAgentTicket({ reg: found.regId, n: found.n, pid: person.profileId, sid: elig.shop.id }, now, AGENT_TICKET_TTL_SECONDS)
    if (!ticket) return backToPage(req, { e: 'unavailable' })
    return backToPage(req, { ticket })
  } catch (e) {
    logError(e, { op: 'agent.claimLookup' })
    return backToPage(req, { e: 'unavailable' })
  }
}
