import { createSupabaseServer } from '@/lib/supabase/server'

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
