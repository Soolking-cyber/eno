import { NextResponse } from 'next/server'
import { route } from '@/lib/api/handler'
import { sweepImportJobs } from '@/lib/fb-import/jobs'
import { sortPendingItems } from '@/lib/fb-import/sort'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Hourly: sorts what a report's after() didn't reach (or the day's AI budget held back), says so to a queue nobody read, and deletes imports past 7 days.
export const GET = route({ auth: 'cron' }, async () => {
  const swept = await sweepImportJobs()
  const sorted = await sortPendingItems(50)
  return NextResponse.json({ ...swept, ...sorted })
})
