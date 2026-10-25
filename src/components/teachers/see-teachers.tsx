'use client'

import { useEffect, useState } from 'react'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { ArrowRight } from '@/components/ui/icons'
import { countTeacherFormEvent } from '@/lib/signup-counters'
import { campaignQuery } from '@/components/teachers/teacher-form-rules'

/**
 * "LOOKING FOR A TEACHER? SEE TEACHERS" — for the Vietnamese-language visitors of the teacher join page (owner, 2026-10-22:
 * "VI visitors → See teachers"). Measured 10-12 → 10-22: 86% of the teacher ad's clicks were Vietnamese-language Facebook
 * users (65% aged 55+), and on step 1 they answered 3 times in 1,470 page loads — parents and schools, the side that HIRES,
 * on a page written for teachers. One tap takes them to the teacher listings (eno.vn/c/teachers, written for the people
 * hiring — category-copy.ts), with the ad's campaign tags, so their first visit there keeps its source.
 * ⛔ The caller shows it only when the page is in Vietnamese: an English visitor here is a teacher. Counted once per page
 * as `see_teachers` (signup-prompt.ts TEACHER_FORM_EVENTS — the same anonymous daily totals, by browser kind and language).
 */
export function SeeTeachers({ apexOrigin, variant = 'card' }: { apexOrigin: string; variant?: 'card' | 'line' }) {
  const { tr } = useLanguage()
  const bare = `${apexOrigin}/c/teachers`
  // The campaign tags this page holds (source, medium, campaign — never a click id), put on the link's own address once the
  // page runs — so a long-press "Open in new tab" or a middle click carries them too, not only a tap (commit gate, codex).
  // The server-rendered first paint has the bare address.
  const [href, setHref] = useState(bare)
  useEffect(() => { setHref(`${bare}${campaignQuery(window.location.search)}`) }, [bare])
  // Counted once per page (countTeacherFormEvent), by a beacon that outlives the navigation. A middle click (it opens the
  // link) counts too — never a right click, which only opens a menu (commit gate, codex).
  const go = () => countTeacherFormEvent('see_teachers')
  const goAux = (e: { button: number }) => { if (e.button === 1) go() }
  if (variant === 'line') {
    return (
      <p className="text-sm text-body" data-testid="see-teachers">
        {tr('Looking for a teacher?', 'Bạn đang tìm giáo viên?')}{' '}
        <Button asChild variant="link" size="none" className="text-sm font-semibold">
          <a href={href} onClick={go} onAuxClick={goAux}>{tr('See teachers', 'Xem giáo viên')}<ArrowRight aria-hidden /></a>
        </Button>
      </p>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-tint p-3.5" data-testid="see-teachers">
      <p className="min-w-0 flex-1 text-sm text-body">{tr('Looking for a teacher for your child or your school?', 'Bạn đang tìm giáo viên cho con hoặc cho trường?')}</p>
      <Button asChild variant="secondary" size="sm">
        <a href={href} onClick={go} onAuxClick={goAux}>{tr('See teachers', 'Xem giáo viên')}<ArrowRight aria-hidden /></a>
      </Button>
    </div>
  )
}
