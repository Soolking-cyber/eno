import 'server-only'
import { createClient } from '@supabase/supabase-js'

// Server-only Supabase client using the secret key (bypasses RLS — never expose).
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SECRET_KEY || '',
  { auth: { persistSession: false, autoRefreshToken: false } },
)

export const LISTINGS_BUCKET = 'listings'
