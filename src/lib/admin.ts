import { createSupabaseServer } from '@/lib/supabase/server'
import { after } from 'next/server'
import { headers } from 'next/headers'
import { db } from '@/lib/db'
import { ensureProfile } from '@/lib/profile'
import { recordPhoneVerified, BASE_SCORE, PHONE_VERIFIED_BONUS } from '@/lib/trust'
import type { Profile } from '@/generated/prisma/client'
import { normalizePhone } from '@/lib/phone'

/** Comma-separated allowlist from ADMIN_EMAILS (server-only env). */
function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return adminEmails().includes(email.toLowerCase())
}

/**
 * Server-side admin gate. Reads the Supabase session from cookies and checks
 * the verified user's email against ADMIN_EMAILS. Returns the admin email on
 * success, or null. Use in server components and route handlers.
 */
export async function getAdmin(): Promise<string | null> {
  const supabase = await createSupabaseServer()
  const { data } = await supabase.auth.getUser()
  const email = data.user?.email ?? null
  return isAdminEmail(email) ? email!.toLowerCase() : null
}

/**
 * The caller's AUTH-CONFIRMED phone in canonical +84… form, or null.
 *
 * ⚠️ USE THIS — NOT `Profile.phone`, AND NEVER A NUMBER OUT OF A REQUEST BODY — WHENEVER A PHONE
 * NUMBER IS BEING USED AS PROOF OF IDENTITY.
 *
 * Claiming an unowned "guest" storefront is the case that matters: it re-parents the Seller row and
 * with it every listing, review and rating, it is irreversible (the claim is guarded by
 * `ownerId: null`, so the real owner can never take it back), and it silently redirects future buyer
 * conversations, because conversation creation resolves the seller side from `Seller.ownerId`.
 *
 * src/lib/profile.ts:71-77 has always done this correctly — "Verified phone only (never a self-typed
 * number)" — but two other paths reimplemented the same claim from `body.phone` with no verification
 * at all (the post-wizard's resolve-seller, and POST /api/profile/account-type). `phoneTakenByOther`
 * does not save them: it deliberately ignores unowned sellers, precisely because they are meant to be
 * claimable by whoever VERIFIES the number — so the one guard on the path cannot fire on the row
 * being stolen. Anyone who knew a guest seller's number — which sellers advertise on Facebook and
 * Zalo — could take the storefront.
 *
 * `Profile.phone` is NOT an acceptable substitute: PATCH /api/profile lets a user write that column
 * without an OTP, so trusting it would just move the same hole one table across.
 */
export async function getVerifiedPhone(): Promise<string | null> {
  try {
    const supabase = await createSupabaseServer()
    const { data } = await supabase.auth.getUser(await bearerToken())
    const u = data.user
    // Supabase stores a confirmed phone on user.phone (E164, no '+'); phone_confirmed_at is the
    // proof. Normalized identically to Seller.phone so the comparison is apples-to-apples.
    return u?.phone && u.phone_confirmed_at ? normalizePhone(u.phone) : null
  } catch {
    return null
  }
}

/**
 * The current authenticated user's app Profile (provisioning it on first call if
 * needed), or null if not signed in. Uses getUser() (JWT-revalidated). Use in
 * server components / route handlers that need the app account.
 */
export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createSupabaseServer()
  const { data } = await supabase.auth.getUser(await bearerToken())
  if (!data.user) return null
  // Lazily provision so a user who signed up before this existed still gets one.
  const existing = await db.profile.findUnique({ where: { id: data.user.id } })
  if (!existing) return ensureProfile(data.user)

  // ensureProfile credits the phone-verified gate (V +10) only at FIRST creation. A phone
  // verified later — or not yet confirmed at that first call (common for phone-OTP) —
  // would otherwise never get it, leaving a verified user stuck at the 60 base floor.
  // Credit it here: idempotent (recordPhoneVerified no-ops if already applied), only for
  // an auth-CONFIRMED phone (never a self-typed business number), only while the score is
  // still below the post-credit baseline (so credited accounts don't re-check), and after
  // the response flushes (zero added latency).
  if (data.user.phone_confirmed_at && existing.trustScore < BASE_SCORE + PHONE_VERIFIED_BONUS) {
    try { after(() => recordPhoneVerified(existing.id).catch(() => {})) } catch { /* no request scope */ }
  }

  // Presence heartbeat (powers the coarse "Active today/this week" bucket — see
  // src/lib/last-seen.ts). Rides this call because it already reads the row; NEVER
  // add it to getCurrentProfileId (hot messaging path, deliberately zero DB) or
  // proxy.ts (edge, no Prisma). The in-row check is only a cheap pre-filter — a
  // page load fans out parallel requests that all see the same stale value, so the
  // WRITE itself re-checks the throttle in its WHERE (updateMany): concurrent
  // stragglers match zero rows instead of stacking redundant updates. after() defers
  // past the response; fire-and-forget.
  const HEARTBEAT_MS = 5 * 60_000
  if (!existing.lastSeenAt || Date.now() - existing.lastSeenAt.getTime() > HEARTBEAT_MS) {
    try {
      after(() =>
        db.profile.updateMany({
          where: {
            id: existing.id,
            OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: new Date(Date.now() - HEARTBEAT_MS) } }],
          },
          data: { lastSeenAt: new Date() },
        }).catch(() => {}),
      )
    } catch { /* no request scope */ }
  }
  return existing
}

/**
 * The current user's id (== Profile.id == auth.users.id), verified LOCALLY from
 * the JWT via getClaims() — NO network round-trip to the auth server and NO DB
 * hit. The project uses asymmetric (ES256) signing keys, so getClaims verifies
 * the signature with cached JWKS; a forged/tampered/expired/absent token all
 * fail-closed to null. Use on HOT messaging read/write paths that only need the
 * user id for participant checks.
 *
 * Trade-off vs getUser(): server-side revocation/ban takes effect at token
 * expiry (~1h) instead of instantly — acceptable for participant-gated 2-party
 * messaging, NOT for admin powers. Does NOT provision a Profile: use
 * getCurrentProfile() where the row must exist (admin, /api/me, account page,
 * conversation create / FK targets).
 */
/** Native-shell Phase 2 · M2: an explicit `Authorization: Bearer <supabase jwt>` is
 *  accepted alongside the cookie session — same JWKS verification, purely additive.
 *  This is what lets LOCAL shell pages (a different origin, no cookies) call the
 *  APIs. Absent header ⇒ the cookie path, byte-identical to before. */
async function bearerToken(): Promise<string | undefined> {
  try {
    const h = (await headers()).get('authorization')
    return h?.startsWith('Bearer ') ? h.slice(7) : undefined
  } catch {
    return undefined
  }
}

export async function getCurrentProfileId(): Promise<string | null> {
  try {
    const supabase = await createSupabaseServer()
    const { data, error } = await supabase.auth.getClaims(await bearerToken())
    const sub = data?.claims?.sub
    return error || !sub ? null : (sub as string)
  } catch {
    return null
  }
}
