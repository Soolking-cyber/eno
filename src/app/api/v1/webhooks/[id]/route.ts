import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { resolveApiKey } from '@/lib/api/auth'
import { apiOk, apiError, apiAuthError } from '@/lib/api/respond'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// DELETE /api/v1/webhooks/{id} — unregister a webhook endpoint. 404 if it isn't this shop's.
// Scope: listings:write.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const r = await resolveApiKey(req, 'listings:write')
  if (!r.ok) return apiAuthError(r)

  const { id } = await params
  const hook = await db.webhookEndpoint.findUnique({ where: { id }, select: { sellerId: true } })
  if (!hook || hook.sellerId !== r.auth.sellerId) return apiError(404, 'not_found', 'Webhook not found.', r.rate)

  await db.webhookEndpoint.delete({ where: { id } })
  return apiOk({ ok: true }, r.rate)
}
