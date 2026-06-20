import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

// Client-side Supabase (publishable/anon key — safe in the browser). SINGLETON:
// one stable instance per tab so Realtime keeps a single socket and auth stays
// in sync (multiple instances = multiple sockets, and setAuth on one wouldn't
// authorize another).
let client: SupabaseClient | null = null

export function createSupabaseBrowser(): SupabaseClient {
  return (client ??= createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  ))
}
