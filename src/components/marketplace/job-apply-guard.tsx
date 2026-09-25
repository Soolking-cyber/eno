'use client'

import { useEffect, useState } from 'react'
import { Tr } from '@/context/language-context'

/**
 * A job reference listing's Apply button, CLOSED ON THE CLIENT once the posting's apply-by date has
 * passed.
 *
 * ⛔ CLIENT-SIDE ON PURPOSE. The PDP is ISR-cached for 30 days and the jobs importer is a script,
 * which cannot revalidate it (no Next runtime). A server-side date check would be frozen into the
 * cached HTML and keep a live "Apply" link on a closed job for up to a month. The date travels in the
 * cached markup; the comparison runs at view time. The importer also hides expired rows, which takes
 * them out of feeds and search (those read live) — this covers the cached page in between.
 *
 * ⚠️ Starts OPEN and closes in an effect, so server and client render the same first frame (no
 * hydration mismatch); a closed job flips within a frame of hydrating.
 */
export function JobApplyGuard({ applyBy, children }: { applyBy: string | null; children: React.ReactNode }) {
  const [closed, setClosed] = useState(false)
  useEffect(() => {
    if (!applyBy || !/^\d{4}-\d{2}-\d{2}$/.test(applyBy)) return
    // End of that day in Vietnam, where every one of these jobs is.
    const end = Date.parse(`${applyBy}T23:59:59+07:00`)
    if (Number.isFinite(end) && Date.now() > end) setClosed(true)
  }, [applyBy])
  if (closed) {
    return (
      <p className="text-sm font-medium text-body">
        <Tr text="This job has closed — the posting is no longer taking applications." />
      </p>
    )
  }
  return <>{children}</>
}
