import { NextResponse } from 'next/server'
import { route } from '@/lib/api/handler'
import { claimImportJob } from '@/lib/fb-import/jobs'
import { workerAuthorized } from '@/lib/fb-import/worker-auth'

export const dynamic = 'force-dynamic'

// The reader on the box asks for work (scripts/fb-import-worker). Outbound only: nothing in its container is reachable from here.
export const POST = route({ auth: 'public' }, async ({ req }) => {
  if (!workerAuthorized(req)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ job: await claimImportJob() }, { headers: { 'Cache-Control': 'no-store' } })
})
