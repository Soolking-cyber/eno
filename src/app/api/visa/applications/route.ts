import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getCurrentProfile } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'
import { encryptVisaPayload, visaCryptoReady } from '@/lib/visa/crypto'
import { getVisaDb, visaTableMissing } from '@/lib/visa/db'
import { visaPaymentsConfig } from '@/lib/visa/payments'
import { serializeVisa, type VisaApplicationRow, type VisaDocumentRow, type VisaEventRow } from '@/lib/visa/records'
import { emptyVisaPayload } from '@/lib/visa/schema'

// APPLICANT visa API — the in-hub port of apps/forum/src/app/api/visa/applications/route.ts.
// Adapted for eno.vn: auth is the COOKIE session (getCurrentProfile) instead of the forum's
// Bearer path — ownership scoping is unchanged because visa_applications.user_id is the
// Supabase auth uid, and Profile.id == auth.users.id (src/lib/profile.ts). Same-origin
// dashboard fetches only, so the forum's CORS/forumJson layer is dropped (repo convention:
// no cookie-auth route here does per-route origin checks).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  const activeMode = new URL(request.url).searchParams.get('active') === '1'
  try {
    const db = getVisaDb()
    const { data, error } = await db.from('visa_applications').select('*').eq('user_id', profile.id).order('updated_at', { ascending: false }).limit(20)
    if (error) throw error
    const applications = (data || []) as VisaApplicationRow[]
    const ids = applications.map((item) => item.id)
    if (activeMode) {
      // ?active=1 — the assistant's mount/poll shape (forum-route parity): the list rows
      // (history) PLUS the active application in DETAIL form (decrypted payload + events,
      // same serialization as GET /api/visa/applications/[id]), replacing the client's
      // former list→detail request waterfall with one round trip. Selection mirrors the
      // client rule it replaces exactly: newest non-cancelled application, else the newest.
      const encryptionReady = visaCryptoReady()
      // Detail requires decryption — without the key, return the (payload-free) list and
      // encryptionReady:false so the client renders the honest "not configured" state.
      const active = encryptionReady ? (applications.find((item) => item.status !== 'cancelled') || applications[0] || null) : null
      const [documentsResult, eventsResult] = await Promise.all([
        ids.length ? db.from('visa_documents').select('*').in('application_id', ids).order('created_at') : Promise.resolve({ data: [] }),
        active ? db.from('visa_events').select('*').eq('application_id', active.id).order('created_at') : Promise.resolve({ data: [] }),
      ])
      const documents = (documentsResult.data || []) as VisaDocumentRow[]
      const events = (eventsResult.data || []) as VisaEventRow[]
      return NextResponse.json({
        application: active ? serializeVisa(active, documents.filter((document) => document.application_id === active.id), events) : null,
        applications: applications.map((item) => serializeVisa(item, documents.filter((document) => document.application_id === item.id), undefined, false)),
        encryptionReady,
        payments: visaPaymentsConfig(),
      })
    }
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
      // Service-fee gate state: null while dormant (client shows the direct submit),
      // otherwise the providers + fee the Review step renders as "Pay & submit".
      payments: visaPaymentsConfig(),
    })
  } catch (error) {
    const code = (error as { code?: string }).code
    const missing = visaTableMissing({ code })
    const message = (error as Error).message
    if (missing || message.includes('not_configured')) {
      return NextResponse.json({ error: missing ? 'visa_schema_not_ready' : message }, { status: 503 })
    }
    // Passport-data route: never echo raw DB/driver error text to the client.
    console.error('[visa] applications GET failed', error)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
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
    if (missing || message.includes('not_configured')) {
      return NextResponse.json({ error: missing ? 'visa_schema_not_ready' : message }, { status: 503 })
    }
    // Passport-data route: never echo raw DB/driver error text to the client.
    console.error('[visa] applications POST failed', error)
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}
