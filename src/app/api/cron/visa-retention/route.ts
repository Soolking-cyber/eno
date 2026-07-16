import { getVisaDb } from '@/lib/visa/db'
import { removeVisaFiles } from '@/lib/visa/storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return Response.json({ error: 'cron_not_configured' }, { status: 503 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const db = getVisaDb()
  const now = new Date().toISOString()
  const { data: applications, error } = await db.from('visa_applications').select('id').not('retention_until', 'is', null).lt('retention_until', now).limit(100)
  if (error) throw error
  let deleted = 0
  for (const application of applications || []) {
    const { data: documents } = await db.from('visa_documents').select('storage_path').eq('application_id', application.id)
    await removeVisaFiles((documents || []).map((item) => item.storage_path))
    const result = await db.from('visa_applications').delete().eq('id', application.id)
    if (!result.error) deleted++
  }
  return Response.json({ ok: true, deleted, checkedAt: now }, { headers: { 'Cache-Control': 'no-store' } })
}
