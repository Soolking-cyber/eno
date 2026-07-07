import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const LISTINGS_BUCKET = 'listings'
// PRIVATE bucket for dispute evidence (receipts, chat screenshots — often carries
// names/account numbers). Never public-URL'd: access is via short-lived signed URLs
// minted inside party/admin-gated routes only. Created by scripts/setup-storage.mjs.
export const EVIDENCE_BUCKET = 'evidence'

let _admin: SupabaseClient | null = null

// Server-only Supabase client using the secret key (bypasses RLS — never expose).
// Created LAZILY: instantiating at module top-level would run during `next build`
// page-data collection and throw "supabaseUrl is required" when env isn't present
// at build time. This way a misconfigured env fails on the first request instead.
export function getSupabaseAdmin(): SupabaseClient {
  if (_admin) return _admin
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY
  if (!url || !key) {
    throw new Error('Supabase admin not configured: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY')
  }
  _admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  return _admin
}
