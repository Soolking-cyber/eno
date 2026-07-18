import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

// The applicant-side counterpart of visaDb() in src/lib/visa-admin.ts, over the SAME
// shared-project service-role client. Applicant routes THROW (they must answer 503,
// not silently render an empty queue), so this maps the missing-env failure to the
// same `visa_database_not_configured` code the forum's routes use.
export function getVisaDb(): SupabaseClient {
  try { return getSupabaseAdmin() }
  catch { throw new Error('visa_database_not_configured') }
}

// Missing-table fail-soft codes (the visa-admin idiom): 42P01 = postgres
// undefined_table, PGRST205 = table absent from the PostgREST schema cache.
// Applicant routes map these to 503 `visa_schema_not_ready`.
const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205'])
export const visaTableMissing = (error: { code?: string } | null | undefined): boolean =>
  !!error && MISSING_TABLE_CODES.has(error.code ?? '')
