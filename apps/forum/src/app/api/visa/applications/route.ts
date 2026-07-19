import { randomUUID } from 'node:crypto'
import { forumJson, forumPreflight, isAllowedForumOrigin } from '@/lib/forum/cors'
import { rateLimit } from '@/lib/ratelimit'
import { getVisaUser } from '@/lib/visa/auth'
import { encryptVisaPayload } from '@/lib/visa/crypto'
import { getVisaDb } from '@/lib/visa/db'
import { serializeVisa, type VisaApplicationRow, type VisaDocumentRow, type VisaEventRow } from '@/lib/visa/records'
import { emptyVisaPayload } from '@/lib/visa/schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const METHODS = 'GET, POST, OPTIONS'

export function OPTIONS(request: Request) { return forumPreflight(request, METHODS) }

export async function GET(request: Request) {
  const user = await getVisaUser(request)
  if (!user) return forumJson(request, { error: 'auth_required' }, { status: 401 }, METHODS)
  const activeMode = new URL(request.url).searchParams.get('active') === '1'
  try {
    const db = getVisaDb()
    const { data, error } = await db.from('visa_applications').select('*').eq('user_id', user.id).order('updated_at', { ascending: false }).limit(20)
    if (error) throw error
    const applications = (data || []) as VisaApplicationRow[]
    const ids = applications.map((item) => item.id)
    if (activeMode) {
      // ?active=1 — the assistant's mount/poll shape: the list rows PLUS the active
      // application in DETAIL form (decrypted payload + events, same serialization as
      // GET /api/visa/applications/[id]), replacing the client's former list→detail
      // request waterfall with one round trip. Selection mirrors the client rule it
      // replaces exactly: newest non-cancelled application, else the newest one.
      const active = applications.find((item) => item.status !== 'cancelled') || applications[0] || null
      const [documentsResult, eventsResult] = await Promise.all([
        ids.length ? db.from('visa_documents').select('*').in('application_id', ids).order('created_at') : Promise.resolve({ data: [] }),
        active ? db.from('visa_events').select('*').eq('application_id', active.id).order('created_at') : Promise.resolve({ data: [] }),
      ])
      const documents = (documentsResult.data || []) as VisaDocumentRow[]
      const events = (eventsResult.data || []) as VisaEventRow[]
      return forumJson(request, {
        application: active ? serializeVisa(active, documents.filter((document) => document.application_id === active.id), events) : null,
        applications: applications.map((item) => serializeVisa(item, documents.filter((document) => document.application_id === item.id), undefined, false)),
      }, undefined, METHODS)
    }
    const documents = ids.length
      ? ((await db.from('visa_documents').select('*').in('application_id', ids).order('created_at')).data || []) as VisaDocumentRow[]
      : []
    return forumJson(request, { applications: applications.map((item) => serializeVisa(item, documents.filter((document) => document.application_id === item.id), undefined, false)) }, undefined, METHODS)
  } catch (error) {
    const code = (error as { code?: string }).code
    return forumJson(request, { error: code === '42P01' ? 'visa_schema_not_ready' : (error as Error).message }, { status: code === '42P01' ? 503 : 500 }, METHODS)
  }
}

export async function POST(request: Request) {
  if (!isAllowedForumOrigin(request)) return forumJson(request, { error: 'origin_not_allowed' }, { status: 403 }, METHODS)
  const user = await getVisaUser(request)
  if (!user) return forumJson(request, { error: 'auth_required' }, { status: 401 }, METHODS)
  const limit = await rateLimit('visa-create', user.id, 5, '24 h', { strict: true })
  if (!limit.success) return forumJson(request, { error: 'rate_limited' }, { status: 429 }, METHODS)
  try {
    const id = randomUUID()
    const now = new Date().toISOString()
    const row = {
      id, user_id: user.id, status: 'draft', encrypted_payload: encryptVisaPayload(emptyVisaPayload(user.email || '')),
      payload_version: 1, checklist: [], last_applicant_action_at: now, created_at: now, updated_at: now,
    }
    const db = getVisaDb()
    const { data, error } = await db.from('visa_applications').insert(row).select('*').single()
    if (error) throw error
    await db.from('visa_events').insert({ id: randomUUID(), application_id: id, actor_type: 'applicant', actor_ref: user.id, event: 'application_created' })
    return forumJson(request, { application: serializeVisa(data as VisaApplicationRow, [], [], true) }, { status: 201 }, METHODS)
  } catch (error) {
    const message = (error as Error).message
    return forumJson(request, { error: message.includes('relation') ? 'visa_schema_not_ready' : message }, { status: message.includes('not_configured') || message.includes('relation') ? 503 : 500 }, METHODS)
  }
}
