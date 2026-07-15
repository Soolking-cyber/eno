import 'server-only'
import { createClient, type User } from '@supabase/supabase-js'
import type { Profile } from '@/generated/prisma/client'
import { getCurrentProfile } from '@/lib/admin'
import { db } from '@/lib/db'
import { ensureProfile } from '@/lib/profile'

export type ForumAuth = {
  profile: Profile
  user: User | null
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return null
  const token = header.slice(7).trim()
  return token || null
}

/**
 * Authenticate either an eno.forum bearer token or an eno.vn cookie session.
 * getUser(token) revalidates the JWT with the shared Supabase Auth project; the
 * database never trusts a profile id supplied by the browser.
 */
export async function getForumAuth(request: Request): Promise<ForumAuth | null> {
  const token = bearerToken(request)
  if (!token) {
    const profile = await getCurrentProfile()
    return profile ? { profile, user: null } : null
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !publishableKey) return null

  const supabase = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return null

  const existing = await db.profile.findUnique({ where: { id: data.user.id } })
  const profile = existing || await ensureProfile(data.user)
  return { profile, user: data.user }
}

export function canParticipate(profile: Profile): boolean {
  return profile.enforcementState !== 'suspended' && profile.enforcementState !== 'held'
}

