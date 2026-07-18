import { forumJson, forumPreflight } from '@/lib/forum/cors'
import { getVisaAdmin, getVisaUser } from '@/lib/visa/auth'
import { getVisaDb } from '@/lib/visa/db'
import { signVisaFile } from '@/lib/visa/storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const METHODS = 'GET, OPTIONS'
export function OPTIONS(request: Request) { return forumPreflight(request, METHODS) }

export async function GET(request: Request, { params }: { params: Promise<{ id: string; documentId: string }> }) {
  const [user, admin] = await Promise.all([getVisaUser(request), getVisaAdmin()])
  if (!user && !admin) return forumJson(request, { error: 'auth_required' }, { status: 401 }, METHODS)
  const { id, documentId } = await params
  const db = getVisaDb()
  const { data: application } = await db.from('visa_applications').select('id,user_id').eq('id', id).maybeSingle()
  if (!application || (!admin && application.user_id !== user?.id)) return forumJson(request, { error: 'not_found' }, { status: 404 }, METHODS)
  const { data: document } = await db.from('visa_documents').select('storage_path').eq('id', documentId).eq('application_id', id).maybeSingle()
  if (!document) return forumJson(request, { error: 'not_found' }, { status: 404 }, METHODS)
  return forumJson(request, { url: await signVisaFile(document.storage_path) }, undefined, METHODS)
}
