'use client'

import { useEffect, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { LocalizedLink } from '@/components/marketplace/localized-link'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { GraduationCap } from '@/components/ui/icons'

/**
 * THE CLASSROOM IS WEB-ONLY (owner, 2026-10-29: "Keep it web-only" — it uses the microphone and holds children's profiles,
 * and stays off the app stores until it is reviewed on its own). In the iOS and Android apps every classroom page shows
 * this instead — never a dead end: THE LINK THE PERSON CAME BY (an invite's code, a report — commit review, opus: a generic
 * address lost it), as text the phone's own Copy carries to the browser — `allow-select`, the app's switch back on for
 * copyable content (globals.css: `html.native` turns selection and the iOS long-press menu off everywhere else; commit
 * review round 5, opus) — and the way back to the app's home. No copy button of its own (commit review round 3: its async state raced navigation every round) and no
 * "open in the browser" (an eno page never leaves the app from inside it — owner, 2026-10-29).
 * Links from outside the app mostly never land here: iOS does not open the app for /classroom (api/well-known/aasa, once
 * the phone has fetched it), and Android's builds from versionCode 6 do not claim it either; older Android builds still do.
 */
export function ClassroomAppNotice() {
  const { tr } = useLanguage()
  // The page's own address — after mount (a server render has no location; no guessed fallback, which would name one
  // edition's host on the other's) and again on every move inside the classroom (the layout stays mounted; codex, round 2).
  const pathname = usePathname()
  const query = useSearchParams()?.toString() ?? ''
  const [link, setLink] = useState<string | null>(null)
  useEffect(() => { setLink(`${window.location.host}${window.location.pathname}${window.location.search}`) }, [pathname, query])
  return (
    <EmptyState
      icon={GraduationCap}
      // A fact, never a promise (commit review round 4, opus): App Review rejects "coming soon" placeholders (2.1).
      title={tr('The classroom works in your phone’s browser', 'Lớp học dùng trên trình duyệt của điện thoại')}
      subtitle={tr(
        'Open this link there to practise — your classes, reports and invites are all there.',
        'Hãy mở link này trên trình duyệt để luyện tập — lớp học, báo cáo và lời mời của bạn đều ở đó.',
      )}
      className="mt-12"
      action={(
        <div className="flex w-full flex-col items-center gap-3">
          {link && <p className="allow-select max-w-full break-all rounded-xl bg-muted px-3 py-2 text-sm text-ink">{link}</p>}
          {/* LocalizedLink: home in the reader's language (the header's way back, classroom-header.tsx). */}
          <Button variant="outline" className="min-h-11" asChild><LocalizedLink href="/" prefetch={false}>{tr('Back to eno', 'Về eno')}</LocalizedLink></Button>
        </div>
      )}
    />
  )
}
