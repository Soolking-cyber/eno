import { z } from 'zod'
import { NextResponse } from 'next/server'
import { getCurrentProfileId } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'
import { encryptVisaPayload, visaCryptoReady } from '@/lib/visa/crypto'
import { getVisaDb } from '@/lib/visa/db'
import { recordVisaEvent, serializeVisa, type VisaApplicationRow, type VisaDocumentRow, type VisaEventRow } from '@/lib/visa/records'
import { visaPayloadSchema } from '@/lib/visa/schema'
import { removeVisaFiles } from '@/lib/visa/storage'

// In-hub port of apps/forum/src/app/api/visa/applications/[id]/route.ts — cookie-session
// auth (Profile.id == auth uid == visa_applications.user_id), no CORS layer. GET and
// PATCH serialize/encrypt the payload, so both are env-gated on visaCryptoReady();
// DELETE never touches the ciphertext and stays available regardless.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const updateSchema = z.object({ payload: visaPayloadSchema })

// Non-uuid path segment would 400 at the uuid column, not 404 — pre-empt it (visa-admin idiom).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function load(id: string, userId: string) {
  const db = getVisaDb()
  const [application, documents, events] = await Promise.all([
    db.from('visa_applications').select('*').eq('id', id).eq('user_id', userId).maybeSingle(),
    db.from('visa_documents').select('*').eq('application_id', id).order('created_at'),
    db.from('visa_events').select('*').eq('application_id', id).order('created_at'),
  ])
  if (application.error) throw application.error
  return { application: application.data as VisaApplicationRow | null, documents: (documents.data || []) as VisaDocumentRow[], events: (events.data || []) as VisaEventRow[] }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentProfileId()
  if (!userId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!visaCryptoReady()) return NextResponse.json({ error: 'visa_encryption_not_configured' }, { status: 503 })
  const loaded = await load(id, userId)
  if (!loaded.application) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ application: serializeVisa(loaded.application, loaded.documents, loaded.events) })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentProfileId()
  if (!userId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  if (!visaCryptoReady()) return NextResponse.json({ error: 'visa_encryption_not_configured' }, { status: 503 })
  const limit = await rateLimit('visa-update', userId, 120, '1 h', { strict: true })
  if (!limit.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  const parsed = updateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_visa_payload', issues: parsed.error.issues }, { status: 400 })
  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const loaded = await load(id, userId)
  if (!loaded.application) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!['draft', 'needs_changes'].includes(loaded.application.status)) return NextResponse.json({ error: 'application_locked' }, { status: 409 })
  const now = new Date().toISOString()
  const { data, error } = await getVisaDb().from('visa_applications').update({
    encrypted_payload: encryptVisaPayload(parsed.data.payload), checklist: [], updated_at: now,
    applicant_confirmed_at: null, applicant_confirmation_version: null, authorized_at: null, authorization_version: null,
    applicant_snapshot_hash: null, authorization_snapshot_hash: null,
    last_applicant_action_at: now,
  }).eq('id', id).eq('user_id', userId).select('*').single()
  if (error) throw error
  await recordVisaEvent(id, 'applicant', 'answers_saved', userId)
  return NextResponse.json({ application: serializeVisa(data as VisaApplicationRow, loaded.documents) })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentProfileId()
  if (!userId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  const limit = await rateLimit('visa-delete', userId, 10, '24 h', { strict: true })
  if (!limit.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const loaded = await load(id, userId)
  if (!loaded.application) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  try {
    await removeVisaFiles(loaded.documents.map((document) => document.storage_path), { strict: true })
    const { error } = await getVisaDb().from('visa_applications').delete().eq('id', id).eq('user_id', userId)
    if (error) throw error
    return NextResponse.json({ deleted: true, id })
  } catch {
    return NextResponse.json({ error: 'application_delete_failed' }, { status: 500 })
  }
}
