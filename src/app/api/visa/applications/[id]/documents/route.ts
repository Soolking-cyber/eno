import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { forumJson, forumPreflight, isAllowedForumOrigin } from '@/lib/forum/cors'
import { rateLimit } from '@/lib/ratelimit'
import { getVisaUser } from '@/lib/visa/auth'
import { getVisaDb } from '@/lib/visa/db'
import { recordVisaEvent } from '@/lib/visa/records'
import { removeVisaFiles, storeVisaImage } from '@/lib/visa/storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const METHODS = 'POST, OPTIONS'
const kindSchema = z.enum(['portrait', 'passport', 'supporting'])

export function OPTIONS(request: Request) { return forumPreflight(request, METHODS) }

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAllowedForumOrigin(request)) return forumJson(request, { error: 'origin_not_allowed' }, { status: 403 }, METHODS)
  const user = await getVisaUser(request)
  if (!user) return forumJson(request, { error: 'auth_required' }, { status: 401 }, METHODS)
  const limit = await rateLimit('visa-document', user.id, 20, '1 h', { strict: true })
  if (!limit.success) return forumJson(request, { error: 'rate_limited' }, { status: 429 }, METHODS)
  const { id } = await params
  const db = getVisaDb()
  const { data: application } = await db.from('visa_applications').select('id,status').eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!application) return forumJson(request, { error: 'not_found' }, { status: 404 }, METHODS)
  if (!['draft', 'needs_changes'].includes(application.status)) return forumJson(request, { error: 'application_locked' }, { status: 409 }, METHODS)
  let form: FormData
  try { form = await request.formData() } catch { return forumJson(request, { error: 'invalid_body' }, { status: 400 }, METHODS) }
  const kind = kindSchema.safeParse(form.get('kind'))
  const file = form.get('file')
  if (!kind.success || !(file instanceof File)) return forumJson(request, { error: 'invalid_document' }, { status: 400 }, METHODS)
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return forumJson(request, { error: 'unsupported_image_type' }, { status: 415 }, METHODS)
  try {
    const stored = await storeVisaImage(Buffer.from(await file.arrayBuffer()), user.id, id, kind.data)
    const { data: old } = kind.data === 'supporting' ? { data: [] } : await db.from('visa_documents').select('id,storage_path').eq('application_id', id).eq('kind', kind.data)
    const document = { id: randomUUID(), application_id: id, kind: kind.data, ...stored, created_at: new Date().toISOString() }
    const { error } = await db.from('visa_documents').insert(document)
    if (error) throw error
    if (old?.length) {
      await db.from('visa_documents').delete().in('id', old.map((item) => item.id))
      await removeVisaFiles(old.map((item) => item.storage_path))
    }
    await recordVisaEvent(id, 'applicant', 'document_uploaded', user.id, { kind: kind.data })
    return forumJson(request, { document: { id: document.id, kind: document.kind, mimeType: document.mime_type, sizeBytes: document.size_bytes, width: document.width, height: document.height, createdAt: document.created_at } }, { status: 201 }, METHODS)
  } catch (error) {
    const code = (error as Error).message.split(':')[0]
    if (['image_size_invalid', 'image_dimensions_invalid', 'image_official_limit_failed'].includes(code)) return forumJson(request, { error: code }, { status: 400 }, METHODS)
    throw error
  }
}
