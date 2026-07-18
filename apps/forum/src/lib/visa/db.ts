import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

export function getVisaDb(): SupabaseClient {
  try { return getSupabaseAdmin() }
  catch { throw new Error('visa_database_not_configured') }
}
