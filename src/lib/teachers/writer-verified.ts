import 'server-only'
// What a teacher is shown about who is writing to them: the chip on the teacher's side of a teacher thread (the DM ladder,
// owner 2026-10-13 — teacher-thread-strip.tsx; the payload is api/conversations/[id]/route.ts, teacher side only).
import { db } from '@/lib/db'
import { canMessage } from '@/lib/compliance/account-state'
import { verificationStatusForDecision } from '@/lib/compliance/recompute-verification'
import { VERIFICATION_FACTS_SELECT, isBusinessVerified } from '@/lib/business-verification'

export type WriterVerified = 'business' | 'identity' | 'unverified'

/**
 * The verification the site already shows in PUBLIC, never the DM rung (dm-quota.ts teacherDmTier). The rung's 'business'
 * also needs the owner's own identity check live, so a school whose public "Business verified" badge is live but whose
 * owner's passport check lapsed — or who was verified before the person-first rule — would have read "Not verified yet"
 * beside a badge that says otherwise (pre-review, 2026-10-13). The badge is the storefront's own predicate: a business
 * account and isBusinessVerified (seller-storefront.tsx, api/sellers/[id]). A revoked identity reads as not verified,
 * badge or not; the rung never shows, and neither does any document.
 */
export async function writerVerified(profileId: string): Promise<WriterVerified> {
  // Both read at the same "now" — the badge's own clock (isBusinessVerified takes none), so no `now` is accepted here.
  const identity = await verificationStatusForDecision(profileId)
  if (!canMessage(identity)) return 'unverified'
  const profile = await db.profile.findUnique({
    where: { id: profileId },
    // The compiler holds this select to every fact the badge reads (business-verification.ts).
    select: { accountType: true, seller: { select: VERIFICATION_FACTS_SELECT } },
  })
  if (profile?.accountType === 'business' && profile.seller && isBusinessVerified(profile.seller)) return 'business'
  return identity === 'verified' ? 'identity' : 'unverified'
}
