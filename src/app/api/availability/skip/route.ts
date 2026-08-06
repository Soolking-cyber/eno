import { db } from '@/lib/db'
import { route } from '@/lib/api/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Records a "Skip for now" on the daily availability review. Increments the consecutive
// skip counter; once it reaches 2, the next review hides the Skip option so the seller has
// to confirm. Confirming (POST /api/listings/availability) resets it to 0.
//
// ⚠️ WS6 MIGRATION — BYTE-IDENTICAL ON THE WIRE. Both branches were checked against the
// hand-written handler this replaces: guest → 401 `{"error":"auth_required"}`, signed-in → 200
// `{"ok":true,"skips":<n>}`, including the `?? 0` fallback when the update itself fails (the
// `.catch(() => null)` is load-bearing and is kept verbatim).
//
// ⚠️ `auth: 'userId'`, NOT `'profile'`. This route only needs "who is this", and
// getCurrentProfileId() verifies the JWT locally with no auth-server round trip and no DB read —
// src/lib/admin.ts warns against adding work to that path. The old handler called exactly that
// function, so `'profile'` would have added a Profile read and lazy provisioning this never needed.
export const POST = route({ auth: 'userId' }, async ({ userId }) => {
  const updated = await db.profile.update({
    where: { id: userId },
    data: { availabilitySkips: { increment: 1 } },
    select: { availabilitySkips: true },
  }).catch(() => null)
  return { ok: true, skips: updated?.availabilitySkips ?? 0 }
})
