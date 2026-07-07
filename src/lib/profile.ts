import 'server-only'
import type { User } from '@supabase/supabase-js'
import { db } from './db'
import { normalizePhone } from './phone'
import { maskEmailHandle } from './utils'
import { checkBanEvasion } from './enforcement'
import { recordNewAccount, recordPhoneVerified, recomputeTrust } from './trust'
import { autoClaimHandle, consolidateSellerHandle } from './handle'

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
  // Never seed the raw email local part as displayName — it's often a full name
  // and displayName short-circuits maskEmailHandle everywhere it's rendered
  // (chat counterparty, public review author). A masked handle is the fallback;
  // the user can set a real name later. (Compliance verification 2026-07-06.)
  const displayName =
    (user.user_metadata?.full_name as string | undefined) ||
    (user.user_metadata?.name as string | undefined) ||
    maskEmailHandle(email)
  const avatarUrl = (user.user_metadata?.avatar_url as string | undefined) ?? null

  let profile
  try {
    profile = await db.profile.upsert({
      where: { id: user.id },
      create: { id: user.id, email, phone: verifiedPhone, displayName, avatarUrl },
      // Don't clobber a user-edited displayName/avatar with provider data on every
      // login — only backfill email/phone (identity), leave profile-owned fields.
      update: { email, ...(verifiedPhone ? { phone: verifiedPhone } : {}) },
    })
  } catch (e) {
    // Phone unique-collision on the rare case the same number is already on another
    // row — login must NEVER throw, so retry without touching the phone.
    if ((e as { code?: string })?.code === 'P2002') {
      profile = await db.profile.upsert({
        where: { id: user.id },
        create: { id: user.id, email, displayName, avatarUrl },
        update: { email },
      })
    } else throw e
  }

  // Verification-gated onboarding: a new account starts below 100 (≈60) and earns
  // up via verification. Both calls are idempotent (applied once ever).
  await recordNewAccount(profile.id).catch(() => {})
  // Public handle from the display name ("Alex Doe" → alex_doe), Telegram-style,
  // shareable as eno.vn/alex_doe — editable later in Dashboard → Settings. ONE handle
  // per account: a storefront owner's single handle lives on the SHOP (see
  // consolidateSellerHandle), so skip the personal claim when they already run one —
  // otherwise every login would re-create a second handle. Idempotent + best-effort.
  const ownsSeller = await db.seller.findUnique({ where: { ownerId: profile.id }, select: { id: true } })
  if (!ownsSeller) await autoClaimHandle({ profileId: profile.id }, profile.displayName)
  // A confirmed phone (e.g. phone-OTP signup) is the baseline trust step → +bonus.
  if (verifiedPhone) await recordPhoneVerified(profile.id).catch(() => {})

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
        const claimed = await db.seller.findUnique({ where: { ownerId: profile.id }, select: { id: true, name: true } })
        // Light up any conversations that were waiting on this seller to claim.
        if (claimed) {
          await db.conversation.updateMany({
            where: { sellerId: claimed.id, sellerProfileId: null },
            data: { sellerProfileId: profile.id },
          })
          // Mirror the owner's (new-account) trust onto the freshly-claimed storefront.
          await recomputeTrust(profile.id).catch(() => {})
          // The account just gained a storefront → collapse to ONE handle on the shop
          // (frees the personal handle claimed moments ago at signup).
          await consolidateSellerHandle(claimed.id, claimed.name, profile.id)
        }
      }
    } catch (e) {
      console.error('[profile] auto-claim failed', e)
    }
  }

  // Ban-evasion check (trust Phase 3) — this is the phone-mirror moment, the ONE
  // place a strong identity attaches to an account (create AND the login backfill
  // when a phone gets verified later): phone is the anchor identity in a
  // phone-verified marketplace. A verified phone matching a suspended account's
  // recorded identity parks THIS account 'held' for admin review — never an
  // auto-ban, because VN families share numbers (a match can be a relative on the
  // household SIM; the admin lifting the hold clears it permanently). Email match
  // = silent flag only. Runs AFTER auto-claim so a hold pulls any freshly-claimed
  // listings too. Uses the auth-verified values, not the mirrored column — the
  // mirror is dropped on phone collision, which is exactly the evasion pattern.
  // Fail-quiet + guarded inside: login must never throw, and pre-migration
  // (scripts/add-ban-evasion.mjs) it skips silently.
  await checkBanEvasion(profile.id, { phone: verifiedPhone, email }).catch(() => {})

  return profile
}
