import { NextRequest, NextResponse } from 'next/server'
import { checkListingOwner } from '@/lib/listing-owner'
import { confirmCore } from '@/lib/core/listings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// "Still available?" → confirm. Carousell-style BUMP: refreshes feed recency
// (postedAt) so the listing rises back up, marks it active, and stamps
// availabilityConfirmedAt. Owner-scoped. The bump is rate-limited (canBump) so a
// seller can't re-confirm daily to camp at the top — a confirm inside the cooldown
// still records availability (stops the reminder) but does NOT re-bump recency.
// auth → core → respond (the bump/confirm logic is shared with the future /api/v1).
//
// ⚠️ WS6 — NOT MIGRATED, same reason as the sibling buyers/ route. Every route() option would be
// empty (public / no limiter / no body schema), and the one that looks fillable — `auth:
// 'profile'` — would DOUBLE-RESOLVE the caller: checkListingOwner (src/lib/listing-owner.ts:15)
// already calls getCurrentProfile(), which is not memoised (no React cache() in admin.ts,
// supabase/server.ts or listing-owner.ts, verified 2026-08-06), so the wrapper would add a second
// getUser() round trip plus a second Profile read to every "still available?" tap.
//
// Branches, all unchanged: guest → 401 auth_required · no storefront → 403 no_storefront ·
// unknown listing → 404 not_found · someone else's listing → 403 forbidden · row deleted between
// the ownership check and the update (confirmCore's P2025 path) → 404 not_found · success → 200
// {"ok":true}. Note the success body deliberately drops confirmCore's `bumped` flag; that is the
// existing contract and a wrapper would not change it either way.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await checkListingOwner(id)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.code })

  const res = await confirmCore(id, auth.profileId)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.code })
  return NextResponse.json({ ok: true })
}
