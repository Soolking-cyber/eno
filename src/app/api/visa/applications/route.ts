import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getCurrentProfile } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'
import { encryptVisaPayload, visaCryptoReady } from '@/lib/visa/crypto'
import { getVisaDb, visaTableMissing } from '@/lib/visa/db'
import { serializeVisa, type VisaApplicationRow, type VisaDocumentRow } from '@/lib/visa/records'
import { emptyVisaPayload } from '@/lib/visa/schema'

// APPLICANT visa API — the in-hub port of apps/forum/src/app/api/visa/applications/route.ts.
// Adapted for eno.vn: auth is the COOKIE session (getCurrentProfile) instead of the forum's
// Bearer path — ownership scoping is unchanged because visa_applications.user_id is the
// Supabase auth uid, and Profile.id == auth.users.id (src/lib/profile.ts). Same-origin
// dashboard fetches only, so the forum's CORS/forumJson layer is dropped (repo convention:
// no cookie-auth route here does per-route origin checks).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  try {
    const db = getVisaDb()
    const { data, error } = await db.from('visa_applications').select('*').eq('user_id', profile.id).order('updated_at', { ascending: false }).limit(20)
    if (error) throw error
    const applications = (data || []) as VisaApplicationRow[]
    const ids = applications.map((item) => item.id)
    const documents = ids.length
      ? ((await db.from('visa_documents').select('*').in('application_id', ids).order('created_at')).data || []) as VisaDocumentRow[]
      : []
    return NextResponse.json({
      // List rows serialize WITHOUT payload (forum parity) — no decryption needed, so the
      // list keeps working on a host without the key…
      applications: applications.map((item) => serializeVisa(item, documents.filter((document) => document.application_id === item.id), undefined, false)),
      // …and this flag tells the dashboard client UP FRONT whether payload routes will work,
      // so the "not configured on this host yet" state renders without a doomed write.
      encryptionReady: visaCryptoReady(),
    })
  } catch (error) {
    const code = (error as { code?: string }).code
    const missing = visaTableMissing({ code })
    return NextResponse.json({ error: missing ? 'visa_schema_not_ready' : (error as Error).message }, { status: missing || (error as Error).message.includes('not_configured') ? 503 : 500 })
  }
}

export async function POST() {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  // Env gate BEFORE any write: creating a draft encrypts the empty payload.
  if (!visaCryptoReady()) return NextResponse.json({ error: 'visa_encryption_not_configured' }, { status: 503 })
  const limit = await rateLimit('visa-create', profile.id, 5, '24 h', { strict: true })
  if (!limit.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  try {
    const id = randomUUID()
    const now = new Date().toISOString()
    const row = {
      id, user_id: profile.id, status: 'draft', encrypted_payload: encryptVisaPayload(emptyVisaPayload(profile.email || '')),
      payload_version: 1, checklist: [], last_applicant_action_at: now, created_at: now, updated_at: now,
    }
    const db = getVisaDb()
    const { data, error } = await db.from('visa_applications').insert(row).select('*').single()
    if (error) throw error
    await db.from('visa_events').insert({ id: randomUUID(), application_id: id, actor_type: 'applicant', actor_ref: profile.id, event: 'application_created' })
    return NextResponse.json({ application: serializeVisa(data as VisaApplicationRow, [], [], true) }, { status: 201 })
  } catch (error) {
    const message = (error as Error).message
    const missing = visaTableMissing(error as { code?: string }) || message.includes('relation')
    return NextResponse.json({ error: missing ? 'visa_schema_not_ready' : message }, { status: message.includes('not_configured') || missing ? 503 : 500 })
  }
}
