import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Resolve the webhook only if it belongs to the caller's (business) shop — else null.
async function ownedHook(id: string): Promise<{ sellerId: string } | null> {
  const profile = await getCurrentProfile()
  if (!profile || profile.accountType !== 'business') return null
  const seller = await db.seller.findUnique({ where: { ownerId: profile.id }, select: { id: true } })
  if (!seller) return null
  const hook = await db.webhookEndpoint.findUnique({ where: { id }, select: { sellerId: true } })
  return hook && hook.sellerId === seller.id ? hook : null
}

// ⚠️ WS6 — NOT MIGRATED (2026-08-06). Both exports. The blockers here are NOT the ones the sibling
// /api/webhooks has, so they are worth stating separately:
//   · A GUEST GETS 404 `{"error":"not_found"}`, NOT 401. `ownedHook()` resolves the caller ITSELF
//     and deliberately answers one code for three different failures — not signed in, not a
//     business shop, and "that webhook is someone else's" — so the route is not an existence
//     oracle for another shop's endpoint ids. Every authed mode would replace the first of those
//     with `{"error":"auth_required"}` 401, which both changes the wire and re-splits a
//     conflation that exists on purpose.
//   · PATCH's ORDER IS OWNERSHIP-THEN-BODY, AND route()'s IS FIXED THE OTHER WAY. The wrapper runs
//     auth → rateLimit → body → handler, so `body:` is validated before the handler can call
//     `ownedHook()`. A PATCH with a bad body aimed at a webhook the caller does not own answers
//     `{"error":"not_found"}` 404 today and would answer `{"error":"invalid_input"}` 400 under the
//     wrapper. (It is only a wire change, not a leak: the wrapper's 400 fires before the ownership
//     check for owned and unowned ids alike, so it distinguishes nothing. The 404 still has to be
//     the answer on that branch, and only the handler can produce it.)
// PATCH — pause/resume an endpoint. Body: { enabled: boolean }.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!(await ownedHook(id))) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  let body: { enabled?: unknown }
  try { body = await req.json() } catch { body = {} }
  if (typeof body.enabled !== 'boolean') return NextResponse.json({ error: 'invalid_input' }, { status: 400 })
  // Re-enabling clears the failure counter so a previously-disabled hook gets a clean retry.
  const hook = await db.webhookEndpoint.update({
    where: { id },
    data: body.enabled ? { enabled: true, failureCount: 0, lastError: null } : { enabled: false },
    select: { id: true, enabled: true },
  })
  return NextResponse.json({ webhook: hook })
}

// DELETE — unregister an endpoint. 404 if it isn't this shop's.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!(await ownedHook(id))) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  await db.webhookEndpoint.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
