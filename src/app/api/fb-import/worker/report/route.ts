import { after, NextResponse } from 'next/server'
import { route } from '@/lib/api/handler'
import { addReportedItems, endImportJob } from '@/lib/fb-import/jobs'
import { FB_IMPORT_MAX_ITEMS, workerReport } from '@/lib/fb-import/shared'
import { sortPendingItems } from '@/lib/fb-import/sort'
import { workerAuthorized } from '@/lib/fb-import/worker-auth'
import { logError } from '@/lib/log'
import { sendMail } from '@/lib/mail'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// What the worker read. ⛔ FENCED BY THE LEASE (jobs.ts): 409 tells a worker that slept through its lease to drop the job. Validated hard: this body is a third party's word about Facebook, and the
// box later fetches the photo links in it (shared.ts isFacebookPhotoUrl).
export const POST = route({ auth: 'public' }, async ({ req }) => {
  if (!workerAuthorized(req)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const parsed = workerReport.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const r = parsed.data
  const held = r.kind === 'items' ? await addReportedItems(r.jobId, r.leaseId, r.items) : await endImportJob(r.jobId, r.leaseId, r.kind)
  if (!held) return NextResponse.json({ error: 'lease_lost' }, { status: 409 })
  if (r.kind === 'finished' || r.kind === 'error' || r.kind === 'unavailable') after(() => sortPendingItems(FB_IMPORT_MAX_ITEMS).then(() => undefined).catch((e: unknown) => logError(e, { op: 'fb-import.sort.after' })))
  if (r.kind === 'unavailable') {
    after(() => sendMail({
      to: 'support@eno.vn',
      subject: 'Import from Facebook: the reading account may need attention',
      text: 'Facebook showed the import worker a login or checkpoint page, or a page that looks blocked, so that seller could not be read. Three in a row, or any login or checkpoint page, stops it: then nobody can import until a person logs in again (infra/vn-node/apply-fb-import.sh --login). Facebook has to be answered by a person. Nothing here tries.',
      html: '<p>Facebook showed the import worker a login or checkpoint page, or a page that looks blocked, so that seller could not be read. Three in a row, or any login or checkpoint page, stops it: then nobody can import until a person logs in again (infra/vn-node/apply-fb-import.sh --login). Facebook has to be answered by a person. Nothing here tries.</p>',
    }).then(() => undefined).catch((e: unknown) => logError(e, { op: 'fb-import.alert' })))
  }
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
})
