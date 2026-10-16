import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { authCookieOptions } from './cookie-options'
import { supabaseServerFetch } from './server-fetch'

// Server-side Supabase (reads/writes the auth session cookies). Use in
// server components / route handlers to read the logged-in user.
export async function createSupabaseServer() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookieOptions: authCookieOptions(),
      // The per-request auth calls over the container network, not through Cloudflare — server-fetch.ts says which, and why
      // supabaseUrl itself stays public (the cookie name is built from it).
      global: { fetch: supabaseServerFetch },
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          } catch {
            // Called from a Server Component — safe to ignore (middleware refreshes).
          }
        },
      },
    },
  )
}
