import { z } from 'zod'
import { forumJson, forumPreflight, isAllowedForumOrigin } from '@/lib/forum/cors'
import { rateLimit } from '@/lib/ratelimit'
import { getVisaUser } from '@/lib/visa/auth'
import { encryptVisaPayload } from '@/lib/visa/crypto'
import { getVisaDb } from '@/lib/visa/db'
import { recordVisaEvent, serializeVisa, type VisaApplicationRow, type VisaDocumentRow, type VisaEventRow } from '@/lib/visa/records'
import { visaPayloadSchema } from '@/lib/visa/schema'
import { removeVisaFiles } from '@/lib/visa/storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const METHODS = 'GET, PATCH, DELETE, OPTIONS'
const updateSchema = z.object({ payload: visaPayloadSchema })

export function OPTIONS(request: Request) { return forumPreflight(request, METHODS) }

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

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getVisaUser(request)
  if (!user) return forumJson(request, { error: 'auth_required' }, { status: 401 }, METHODS)
  const { id } = await params
  const loaded = await load(id, user.id)
  if (!loaded.application) return forumJson(request, { error: 'not_found' }, { status: 404 }, METHODS)
  return forumJson(request, { application: serializeVisa(loaded.application, loaded.documents, loaded.events) }, undefined, METHODS)
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAllowedForumOrigin(request)) return forumJson(request, { error: 'origin_not_allowed' }, { status: 403 }, METHODS)
  const user = await getVisaUser(request)
  if (!user) return forumJson(request, { error: 'auth_required' }, { status: 401 }, METHODS)
  const limit = await rateLimit('visa-update', user.id, 120, '1 h', { strict: true })
  if (!limit.success) return forumJson(request, { error: 'rate_limited' }, { status: 429 }, METHODS)
  const parsed = updateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return forumJson(request, { error: 'invalid_visa_payload', issues: parsed.error.issues }, { status: 400 }, METHODS)
  const { id } = await params
  const loaded = await load(id, user.id)
  if (!loaded.application) return forumJson(request, { error: 'not_found' }, { status: 404 }, METHODS)
  if (!['draft', 'needs_changes'].includes(loaded.application.status)) return forumJson(request, { error: 'application_locked' }, { status: 409 }, METHODS)
  const now = new Date().toISOString()
  const { data, error } = await getVisaDb().from('visa_applications').update({
    encrypted_payload: encryptVisaPayload(parsed.data.payload), checklist: [], updated_at: now,
    applicant_confirmed_at: null, applicant_confirmation_version: null, authorized_at: null, authorization_version: null,
    applicant_snapshot_hash: null, authorization_snapshot_hash: null,
    last_applicant_action_at: now,
  }).eq('id', id).eq('user_id', user.id).in('status', ['draft', 'needs_changes']).select('*').maybeSingle()
  if (error) throw error
  // CAS (audit P1 #4): the JS status pre-check above is not a guard — if the case
  // left the editable states between read and write (admin picked it up, payment
  // handoff fired), the save must MISS, never overwrite an under-review payload
  // and null its consent stamps.
  if (!data) return forumJson(request, { error: 'application_locked' }, { status: 409 }, METHODS)
  await recordVisaEvent(id, 'applicant', 'answers_saved', user.id)
  return forumJson(request, { application: serializeVisa(data as VisaApplicationRow, loaded.documents) }, undefined, METHODS)
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAllowedForumOrigin(request)) return forumJson(request, { error: 'origin_not_allowed' }, { status: 403 }, METHODS)
  const user = await getVisaUser(request)
  if (!user) return forumJson(request, { error: 'auth_required' }, { status: 401 }, METHODS)
  const limit = await rateLimit('visa-delete', user.id, 10, '24 h', { strict: true })
  if (!limit.success) return forumJson(request, { error: 'rate_limited' }, { status: 429 }, METHODS)
  const { id } = await params
  const loaded = await load(id, user.id)
  if (!loaded.application) return forumJson(request, { error: 'not_found' }, { status: 404 }, METHODS)

  try {
    await removeVisaFiles(loaded.documents.map((document) => document.storage_path), { strict: true })
    const { error } = await getVisaDb().from('visa_applications').delete().eq('id', id).eq('user_id', user.id)
    if (error) throw error
    return forumJson(request, { deleted: true, id }, undefined, METHODS)
  } catch {
    return forumJson(request, { error: 'application_delete_failed' }, { status: 500 }, METHODS)
  }
}
