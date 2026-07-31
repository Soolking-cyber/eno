import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { NextResponse } from 'next/server'
import { getCurrentProfileId } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'
import { decryptVisaPayload, encryptVisaPayload, visaCryptoReady } from '@/lib/visa/crypto'
import { getVisaDb } from '@/lib/visa/db'
import { recordVisaEvent } from '@/lib/visa/records'
import { removeVisaFiles, storeVisaImage } from '@/lib/visa/storage'

// In-hub port of apps/forum/src/app/api/visa/applications/[id]/documents/route.ts —
// cookie-session auth, no CORS layer. A passport upload records AI-processing consent
// INSIDE the encrypted payload, so the route is env-gated on visaCryptoReady() (an
// upload that couldn't record consent would fork the two surfaces' behavior).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const kindSchema = z.enum(['portrait', 'passport', 'supporting'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentProfileId()
  if (!userId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  if (!visaCryptoReady()) return NextResponse.json({ error: 'visa_encryption_not_configured' }, { status: 503 })
  const limit = await rateLimit('visa-document', userId, 20, '1 h', { strict: true })
  if (!limit.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const db = getVisaDb()
  const { data: application } = await db.from('visa_applications').select('id,status,encrypted_payload').eq('id', id).eq('user_id', userId).maybeSingle()
  if (!application) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!['draft', 'needs_changes'].includes(application.status)) return NextResponse.json({ error: 'application_locked' }, { status: 409 })
  let form: FormData
  try { form = await request.formData() } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400 }) }
  const kind = kindSchema.safeParse(form.get('kind'))
  const file = form.get('file')
  if (!kind.success || !(file instanceof File)) return NextResponse.json({ error: 'invalid_document' }, { status: 400 })
  const acceptedMime = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
  const acceptedExtension = /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)
  if (!acceptedMime.includes(file.type.toLowerCase()) && !acceptedExtension) return NextResponse.json({ error: 'unsupported_image_type' }, { status: 415 })
  try {
    // Size guard BEFORE arrayBuffer() — otherwise a huge upload is fully buffered into
  // memory before storeVisaImage's downstream validation ever sees it.
  if (file.size > 15_000_000) return NextResponse.json({ error: 'image_size_invalid' }, { status: 400 })
  const stored = await storeVisaImage(Buffer.from(await file.arrayBuffer()), userId, id, kind.data)
    const { data: old } = kind.data === 'supporting' ? { data: [] } : await db.from('visa_documents').select('id,storage_path').eq('application_id', id).eq('kind', kind.data)
    const document = { id: randomUUID(), application_id: id, kind: kind.data, ...stored, created_at: new Date().toISOString() }
    const { error } = await db.from('visa_documents').insert(document)
    if (error) throw error
    if (kind.data === 'passport') {
      const payload = decryptVisaPayload(application.encrypted_payload)
      if (!payload.aiDocumentProcessingConsent) {
        payload.aiDocumentProcessingConsent = true
        const consentUpdate = await db.from('visa_applications').update({ encrypted_payload: encryptVisaPayload(payload), updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', userId)
        if (consentUpdate.error) throw consentUpdate.error
      }
    }
    if (old?.length) {
      await db.from('visa_documents').delete().in('id', old.map((item) => item.id))
      await removeVisaFiles(old.map((item) => item.storage_path))
    }
    await recordVisaEvent(id, 'applicant', 'document_uploaded', userId, { kind: kind.data, corrections: document.validation_report.corrections })
    return NextResponse.json({ document: { id: document.id, kind: document.kind, mimeType: document.mime_type, sizeBytes: document.size_bytes, width: document.width, height: document.height, validationStatus: document.validation_status, validationReport: document.validation_report, createdAt: document.created_at } }, { status: 201 })
  } catch (error) {
    const code = (error as Error).message.split(':')[0]
    if (['image_size_invalid', 'image_dimensions_invalid', 'image_decode_failed', 'portrait_resolution_too_low', 'passport_resolution_too_low', 'image_official_limit_failed'].includes(code)) return NextResponse.json({ error: code }, { status: 400 })
    throw error
  }
}
