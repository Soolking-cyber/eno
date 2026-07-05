import { createSupabaseServer } from '@/lib/supabase/server'
import { after } from 'next/server'
import { db } from '@/lib/db'
import { ensureProfile } from '@/lib/profile'
import { recordPhoneVerified, BASE_SCORE, PHONE_VERIFIED_BONUS } from '@/lib/trust'
import type { Profile } from '@/generated/prisma/client'

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
 * The current authenticated user's app Profile (provisioning it on first call if
 * needed), or null if not signed in. Uses getUser() (JWT-revalidated). Use in
 * server components / route handlers that need the app account.
 */
export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createSupabaseServer()
  const { data } = await supabase.auth.getUser()
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
export async function getCurrentProfileId(): Promise<string | null> {
  try {
    const supabase = await createSupabaseServer()
    const { data, error } = await supabase.auth.getClaims()
    const sub = data?.claims?.sub
    return error || !sub ? null : (sub as string)
  } catch {
    return null
  }
}
