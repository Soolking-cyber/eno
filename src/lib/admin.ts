import { createSupabaseServer } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { ensureProfile } from '@/lib/profile'
import type { Profile } from '@prisma/client'

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
  return existing ?? (await ensureProfile(data.user))
}
