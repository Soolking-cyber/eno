import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

// Client-side Supabase (publishable/anon key — safe in the browser). SINGLETON:
// one stable instance per tab so Realtime keeps a single socket and auth stays
// in sync (multiple instances = multiple sockets, and setAuth on one wouldn't
// authorize another).
let client: SupabaseClient | null = null

export function createSupabaseBrowser(): SupabaseClient {
  if (client) return client
  client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  )
  // Private Realtime channels authorize off the user JWT. Arm realtime auth now
  // and RE-arm on every token refresh, or a private channel silently stops
  // delivering once the access token expires (~1h). Registered once per tab
  // because the client is a singleton.
  const arm = (token?: string) => { if (token) client!.realtime.setAuth(token) }
  client.auth.getSession().then(({ data }) => arm(data.session?.access_token))
  client.auth.onAuthStateChange((_event, session) => arm(session?.access_token))
  return client
}
