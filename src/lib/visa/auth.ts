import 'server-only'
import { createClient, type User } from '@supabase/supabase-js'
import { createSupabaseServer } from '@/lib/supabase/server'

export const VISA_SUPPORT_ADMIN_EMAIL = 'support@eno.forum'

export async function getVisaUser(request: Request): Promise<User | null> {
  const authorization = request.headers.get('authorization')
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
  if (!token) {
    const { data } = await (await createSupabaseServer()).auth.getUser()
    return data.user ?? null
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) return null
  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data, error } = await supabase.auth.getUser(token)
  return error ? null : data.user
}

function adminEmails(): Set<string> {
  return new Set([
    VISA_SUPPORT_ADMIN_EMAIL,
    ...(process.env.VISA_ADMIN_EMAILS || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean),
  ])
}

export async function getVisaAdmin(): Promise<string | null> {
  const { data } = await (await createSupabaseServer()).auth.getUser()
  const email = data.user?.email?.toLowerCase() || null
  return email && adminEmails().has(email) ? email : null
}
