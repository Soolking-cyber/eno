'use client'

/* eslint-disable react/jsx-no-literals -- deliberately bilingual (VI+EN shown at once, like the
   ND52 test-operation notice beside it): this is a legal announcement, not UI copy, so it must not
   depend on the reader having found the language toggle. */
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { TOS_EFFECTIVE_FROM, TOS_VERSION, tosInNoticeWindow } from '@/lib/site-legal'

/**
 * The on-platform announcement of a pending Terms change.
 *
 * ⚠️ THIS EXISTS BECAUSE PUBLISHING THE NEW TERMS IS NOT ANNOUNCING THEM. Decree 52/2013 Đ.38.3
 * requires a material change to be ANNOUNCED on the platform at least 5 days before it takes
 * effect, and `/regulations` promises exactly that in Vietnamese. Updating `/terms` satisfies
 * "published"; it does not reach a single existing user, because nobody navigates to the terms page
 * unprompted. An external review put it plainly: binding existing users off the back of a page they
 * were never shown is not an announcement. So the announcement has to come to them.
 *
 * It removes itself: {@link tosInNoticeWindow} is false once the new version takes effect, so there
 * is no flag to remember to flip and no banner to find still running in October.
 *
 * ⚠️ CLIENT COMPONENT, AND THAT IS THE WHOLE POINT — DO NOT "OPTIMISE" IT TO A SERVER ONE.
 * Its visibility depends on the CLOCK, and this banner renders on every page in the app, including
 * every statically prerendered one. A server render would be baked into that HTML at build time and
 * served from disk long after the window closed — which is not a hypothetical here: /terms and
 * /regulations shipped with exactly that defect one commit earlier and had to be given
 * `revalidate`. The sibling PrelaunchNotice IS a server component and correctly so, because
 * `PRELAUNCH` is a build-time constant; the difference is the clock, not the styling.
 *
 * Computing after mount (rather than during render) also keeps the server and client markup
 * identical, so there is no hydration mismatch — the banner simply appears on the first client
 * paint.
 */
export function TosChangeNotice() {
  const [show, setShow] = useState(false)
  useEffect(() => { setShow(tosInNoticeWindow()) }, [])
  if (!show) return null

  return (
    <div id="tos-change-banner" role="status" className="bg-warning/10 px-3 py-1.5 text-center text-2xs leading-snug text-warning">
      {/* Same colour treatment as PrelaunchNotice, and for the same measured reason: --warning at
          80% opacity lands at 3.95:1 on its own tint and fails WCAG AA on a site-wide banner. */}
      <span className="font-semibold">
        Điều khoản dịch vụ đã được cập nhật (phiên bản {TOS_VERSION}) và sẽ có hiệu lực từ ngày {TOS_EFFECTIVE_FROM}.
      </span>{' '}
      <span>
        Our Terms of Service have been updated (version {TOS_VERSION}) and take effect on {TOS_EFFECTIVE_FROM}.
      </span>{' '}
      <Link href="/terms" className="font-semibold underline underline-offset-2">
        Xem / Read
      </Link>
    </div>
  )
}
