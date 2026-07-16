import { randomUUID } from 'node:crypto'
import { getVisaAdmin } from '@/lib/visa/auth'
import { getVisaDb } from '@/lib/visa/db'
import { recordVisaEvent } from '@/lib/visa/records'
import { removeVisaFiles, storeVisaResult } from '@/lib/visa/storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getVisaAdmin()
  if (!admin) return Response.json({ error: 'admin_required' }, { status: 403 })
  const { id } = await params
  const db = getVisaDb()
  const { data: application } = await db.from('visa_applications').select('id,user_id,assigned_admin,status').eq('id', id).maybeSingle()
  if (!application) return Response.json({ error: 'not_found' }, { status: 404 })
  if (!['submitted', 'payment_required', 'processing'].includes(application.status)) return Response.json({ error: 'application_not_submitted' }, { status: 409 })
  let form: FormData
  try { form = await request.formData() } catch { return Response.json({ error: 'invalid_body' }, { status: 400 }) }
  const file = form.get('file')
  if (!(file instanceof File) || file.type !== 'application/pdf') return Response.json({ error: 'pdf_required' }, { status: 400 })
  try {
    const stored = await storeVisaResult(Buffer.from(await file.arrayBuffer()), application.user_id, id)
    const { data: old } = await db.from('visa_documents').select('id,storage_path').eq('application_id', id).eq('kind', 'result')
    const document = { id: randomUUID(), application_id: id, kind: 'result', ...stored, created_at: new Date().toISOString() }
    const { error } = await db.from('visa_documents').insert(document)
    if (error) throw error
    if (old?.length) { await db.from('visa_documents').delete().in('id', old.map((item) => item.id)); await removeVisaFiles(old.map((item) => item.storage_path)) }
    const now = new Date()
    await db.from('visa_applications').update({ status: 'approved', assigned_admin: application.assigned_admin || admin, resolved_at: now.toISOString(), retention_until: new Date(now.getTime() + 90 * 86400_000).toISOString(), updated_at: now.toISOString() }).eq('id', id)
    await recordVisaEvent(id, 'admin', 'result_uploaded', admin)
    return Response.json({ status: 'approved', document: { id: document.id, kind: 'result' } }, { status: 201 })
  } catch (error) {
    if ((error as Error).message === 'result_pdf_invalid') return Response.json({ error: 'result_pdf_invalid' }, { status: 400 })
    throw error
  }
}
