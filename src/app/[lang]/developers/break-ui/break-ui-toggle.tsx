'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BREAK_UI_STATES, type BreakUiState } from '@/lib/__fixtures__/break-ui'
import { cn } from '@/lib/utils'

/**
 * The dev-only data switch: Demo data / Worst case / Empty / One / 1,000 rows.
 * Chrome, not design — plain, neutral, fixed bottom-centre, out of the components' way. The state lives
 * in `?data=` so a reload keeps it, and switching swaps the FIXTURE (the data boundary), never markup.
 * ⚠️ `inset-x-3 mx-auto w-fit flex-wrap`, not `left-1/2 -translate-x-1/2`: the five labels are ~385px on one
 * line, and centring a 385px bar on a 320px screen put "Demo data" and "1,000 rows" past both edges (codex,
 * measured x −33…353). It now wraps inside the screen's gutters and stays one line wherever it fits.
 */
export function BreakUiToggle({ state }: { state: BreakUiState }) {
  const pathname = usePathname()
  return (
    <nav
      aria-label="Fixture data"
      className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-50 mx-auto flex w-fit flex-wrap justify-center gap-0.5 rounded-2xl bg-muted p-1 font-sans text-xs shadow-pop ring-1 ring-foreground/10"
    >
      {BREAK_UI_STATES.map((s) => (
        <Link
          key={s.key}
          href={`${pathname}?data=${s.key}`}
          scroll={false}
          aria-current={s.key === state ? 'true' : undefined}
          className={cn(
            'rounded-full px-3 py-1.5 whitespace-nowrap',
            s.key === state ? 'bg-background font-semibold text-foreground shadow-sm' : 'text-muted-foreground',
          )}
        >
          {s.label}
        </Link>
      ))}
    </nav>
  )
}
