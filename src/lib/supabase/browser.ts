import { createBrowserClient } from '@supabase/ssr'

// Client-side Supabase (uses the publishable/anon key — safe in the browser).
export function createSupabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  )
}
