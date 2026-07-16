import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { getVisaAdmin } from '@/lib/visa/auth'
import { getVisaDb } from '@/lib/visa/db'
import { recordVisaEvent } from '@/lib/visa/records'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getVisaAdmin()
  if (!admin) return Response.json({ error: 'admin_required' }, { status: 403 })
  const { id } = await params
  const db = getVisaDb()
  const [{ data: application }, { data: documents }] = await Promise.all([
    db.from('visa_applications').select('status,authorized_at,authorization_snapshot_hash').eq('id', id).maybeSingle(),
    db.from('visa_documents').select('kind,validation_status').eq('application_id', id).in('kind', ['passport', 'portrait']),
  ])
  if (!application) return Response.json({ error: 'not_found' }, { status: 404 })
  if (application.status !== 'ready_to_submit' || !application.authorized_at || !application.authorization_snapshot_hash) return Response.json({ error: 'applicant_authorization_required' }, { status: 409 })
  if (!['passport', 'portrait'].every((kind) => (documents || []).some((document) => document.kind === kind && document.validation_status === 'passed'))) return Response.json({ error: 'verified_images_required' }, { status: 409 })
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + 5 * 60_000)
  const { error } = await db.from('visa_prefill_sessions').insert({ id: randomUUID(), application_id: id, token_hash: createHash('sha256').update(token).digest('hex'), created_by: admin, expires_at: expiresAt.toISOString() })
  if (error) throw error
  await recordVisaEvent(id, 'admin', 'prefill_session_created', admin)
  const origin = new URL(request.url).origin
  return Response.json({ command: `npm run visa:prefill -- ${origin}/api/visa/prefill/${token}`, expiresAt: expiresAt.toISOString() }, { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })
}
