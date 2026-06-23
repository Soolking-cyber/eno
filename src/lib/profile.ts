import 'server-only'
import type { User } from '@supabase/supabase-js'
import { db } from './db'
import { normalizePhone } from './phone'
import { recordNewAccount, recomputeTrust } from './trust'

/**
 * Idempotent: ensure the authenticated user has exactly one Profile row
 * (Profile.id == auth.users.id). Called from the auth callback and lazily from
 * any server action needing a profile. Mirrors email/phone/displayName from the
 * Supabase user. Provisioning runs via the pooled Prisma connection, which
 * bypasses RLS (intended — there is no client INSERT policy on Profile).
 */
export async function ensureProfile(user: User) {
  const email = user.email ?? null
  // Supabase stores a verified phone on user.phone (E164, no '+'); normalize to
  // the app's canonical +84… form. Only mirror a CONFIRMED phone.
  const verifiedPhone = user.phone && user.phone_confirmed_at ? normalizePhone(user.phone) : null
  const displayName =
    (user.user_metadata?.full_name as string | undefined) ||
    (user.user_metadata?.name as string | undefined) ||
    (email ? email.split('@')[0] : null)
  const avatarUrl = (user.user_metadata?.avatar_url as string | undefined) ?? null

  const profile = await db.profile.upsert({
    where: { id: user.id },
    create: { id: user.id, email, phone: verifiedPhone, displayName, avatarUrl },
    // Don't clobber a user-edited displayName/avatar with provider data on every
    // login — only backfill email/phone (identity), leave profile-owned fields.
    update: { email, ...(verifiedPhone ? { phone: verifiedPhone } : {}) },
  })

  // KYC-gated onboarding: a new account starts below the 100 baseline (≈60) and
  // earns up to 100 via profile completion + KYC. Idempotent (applied once ever).
  await recordNewAccount(profile.id).catch(() => {})

  // Auto-claim: if the user has a VERIFIED phone matching an UNOWNED guest Seller,
  // stamp ownership — transferring the storefront + all its listings/reviews with
  // a single-column update. Guarded by ownerId:null (claim-once). Verified phone
  // only (never a self-typed number), normalized identically to the post wizard
  // (same canonical +84… form Seller.phone is stored in).
  if (verifiedPhone) {
    try {
      // Atomic claim-once: updateMany with the ownerId:null guard.
      const r = await db.seller.updateMany({
        where: { phone: verifiedPhone, ownerId: null },
        data: { ownerId: profile.id, claimedAt: new Date() },
      })
      if (r.count > 0) {
        const claimed = await db.seller.findUnique({ where: { ownerId: profile.id }, select: { id: true } })
        // Light up any conversations that were waiting on this seller to claim.
        if (claimed) {
          await db.conversation.updateMany({
            where: { sellerId: claimed.id, sellerProfileId: null },
            data: { sellerProfileId: profile.id },
          })
          // Mirror the owner's (new-account) trust onto the freshly-claimed storefront.
          await recomputeTrust(profile.id).catch(() => {})
        }
      }
    } catch (e) {
      console.error('[profile] auto-claim failed', e)
    }
  }

  return profile
}
