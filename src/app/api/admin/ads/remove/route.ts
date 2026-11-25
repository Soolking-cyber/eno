import { route, ApiError } from '@/lib/api/handler'
import { removeAdCreative } from '@/lib/ads/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * "Remove" — Admin › Catalogue › Ads (owner 2026-11-25: eno may remove an unlawful ad). Takes one creative down for good:
 * src/lib/ads/admin.ts removeAdCreative — the creative `removed` with the reason, its runs ended now (the unused part is
 * the pro-rata refund the policy promises on request), the audit row, the serving set read again, eno's copy of the
 * picture deleted. It stops serving within a minute. getAdmin() is re-checked here (route auth 'admin').
 */
export const POST = route({ auth: 'admin' }, async ({ req, admin }) => {
  const body = (await req.json().catch(() => null)) as { creativeId?: unknown; reason?: unknown } | null
  const creativeId = typeof body?.creativeId === 'string' ? body.creativeId : ''
  const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 300) : ''
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(creativeId)) throw new ApiError('bad_request', 400)
  if (!reason) throw new ApiError('reason_required', 400)
  const out = await removeAdCreative(creativeId, admin, reason)
  if (!out) throw new ApiError('not_found', 404)
  return { ok: true, ...out }
})
