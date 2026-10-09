'use client'

// "Available: From November 2026" on the public teacher profile (teacher onboarding redesign, owner, 2026-10-08): a
// MONTH — the form asks "When can you start?" as Now / a month, stored as the month's first day — and "Available: Now"
// once the start has come. This renders the value; the row's label ("Available") is the page's.
import { useEffect, useState } from 'react'
import { useLanguage } from '@/context/language-context'
import { fillBilingual } from '@/components/marketplace/bilingual'
import { isMtLanguage } from '@/lib/i18n/langs'
import { safeTemplate } from '@/lib/i18n/placeholders'
import { availableMonthLabel, msUntilStart, startHasBegun } from '@/lib/teachers/profile-view'

/** setTimeout's ceiling (2^31 − 1 ms, ~24.8 days): a longer delay fires AT ONCE, so a far start re-checks at the cap. */
const MAX_TIMER_MS = 2 ** 31 - 1

/**
 * `from` — the stored start DAY, 'YYYY-MM-DD' (profile-view.ts availableStart): its month is what the page says, the
 * day is when it turns into "Now" (an old row's day is kept — "Now" never comes before the day the teacher gave).
 *
 * ⛔ NO CLOCK IN THE CACHED HTML, AND NONE IN THE FIRST RENDER. The profile page is ISR-cached for days: a server
 * `new Date()` would freeze one moment's "now" into every reader's copy, and reading the clock while rendering would
 * make the browser's first paint differ from the server's HTML (a React #418). So the server — and the browser's
 * first render — say the month ("From November 2026"); only the effect asks the READER's clock, and turns it into
 * "Now" once the start day has begun (Vietnam's calendar — profile-view.ts startHasBegun).
 * ⚠️ AND AGAIN AT THAT MIDNIGHT, IF THE PAGE IS STILL OPEN (gate review, 2026-10-08): asked once at mount, a profile
 * left open across the 1st kept saying "From November 2026" until a reload. A timer waits for the start
 * (msUntilStart), and coming back to the tab asks the clock again — a sleeping laptop's or a frozen tab's timer fires
 * late, never early, so the visit is what catches it up.
 * ⚠️ THE MONTH NAME FOLLOWS THE LINE AROUND IT: a machine-translated language gets its own month name only inside a
 * translated line — while the translation is on its way the line is English, and so is the month (Bilingual's
 * datesIso rule, for a month).
 */
export function TeacherAvailableFrom({ from }: { from: string }) {
  const { tr, lang } = useLanguage()
  const [begun, setBegun] = useState(false)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const check = () => {
      clearTimeout(timer)
      const now = Date.now()
      setBegun(startHasBegun(from, now))
      const wait = msUntilStart(from, now)
      if (wait != null) timer = setTimeout(check, Math.min(wait, MAX_TIMER_MS))
    }
    check()
    document.addEventListener('visibilitychange', check)
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', check) }
  }, [from])
  if (begun) return <>{tr('Now', 'Ngay')}</>
  const en = 'From {month}'
  const line = tr('From {month}', 'Từ {month}')
  const translated = isMtLanguage(lang) && safeTemplate(line, en) !== en
  return <>{fillBilingual(line, en, { month: availableMonthLabel(from.slice(0, 7), translated ? lang : lang === 'vi' ? 'vi' : 'en') })}</>
}
