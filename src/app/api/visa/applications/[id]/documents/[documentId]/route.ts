import { NextResponse } from 'next/server'
import { getAdmin, getCurrentProfileId } from '@/lib/admin'
import { getVisaDb } from '@/lib/visa/db'
import { signVisaFile } from '@/lib/visa/storage'

// In-hub port of apps/forum/src/app/api/visa/applications/[id]/documents/[documentId]/route.ts —
// short-lived signed URL for a private visa document. Owner OR eno.vn admin (ADMIN_EMAILS,
// mirroring the forum's owner-or-visa-admin gate). No payload access → no crypto gate.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; documentId: string }> }) {
  const [userId, admin] = await Promise.all([getCurrentProfileId(), getAdmin()])
  if (!userId && !admin) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  const { id, documentId } = await params
  if (!UUID_RE.test(id) || !UUID_RE.test(documentId)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const db = getVisaDb()
  const { data: application } = await db.from('visa_applications').select('id,user_id').eq('id', id).maybeSingle()
  if (!application || (!admin && application.user_id !== userId)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const { data: document } = await db.from('visa_documents').select('storage_path').eq('id', documentId).eq('application_id', id).maybeSingle()
  if (!document) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ url: await signVisaFile(document.storage_path) })
}
