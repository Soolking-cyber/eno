'use client'

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ChevronDown } from '@/components/ui/icons'
import { cn } from '@/lib/utils'

/**
 * A SHOW/HIDE ROW: the WAI-ARIA disclosure pattern. A heading holds a `<button aria-expanded>`, and the answer sits in a panel
 * that button controls. The classes are ui/accordion's (`acc-trigger`, `acc-chevron`, which turns on `data-panel-open`), so it
 * looks the same. Each row opens and closes on its own (Base UI's `multiple`).
 *
 * ⛔ HAND-ROLLED ON PURPOSE (CLAUDE.md: Base UI first, then a purpose-built library, hand-rolled last, with the reason).
 * Measured on the phone home, 2026-11-25 (local profiling build, phone 412 px at 4× CPU):
 *   · Base UI Accordion / Collapsible: RULED OUT for any group that hydrates with the page.
 *     - Each panel reads getComputedStyle in a layout effect on mount, then writes `hidden="until-found"`: a forced full-page
 *       style pass per panel (the home FAQ's 17: 254 + 52 ms of the worst long task).
 *     - Its CompositeList registers every item with a setState in a layout effect. That is a SYNC update inside the
 *       hydration commit, and React then flushes EVERY passive effect of the page in the same task before rendering it.
 *       A React commit probe read `root.pendingUpdatersLaneMap` right after the hydration commit's layout effects (main
 *       b3a89597e): the footer's accordion was one of only two components that scheduled Sync there (with SortStrip's tabs).
 *   · Native `<details>`: RULED OUT. The question must stay a heading in its row, and inside `<summary>` (exposed as a button
 *     by several browser + screen-reader pairs) a heading can be flattened, so heading navigation would skip it. The
 *     footer's groups are also independent (`multiple`), and `<details name>` would make them exclusive.
 *   · No library fills the gap: this is one state and one button.
 * The closed panel is in the server's HTML as `hidden`, because React writes that attribute only as a boolean. After
 * hydration, one PASSIVE effect upgrades it to `until-found`: a single write, no style read, no state update. Find-in-page
 * then reaches every closed panel, and the browser's `beforematch` opens the row that holds the match.
 * ↑ / ↓ / Home / End move between the rows of one group, as Base UI's accordion did: the nearest `[data-disclosure-group]`
 * (DISCLOSURE_GROUP, ./disclosure-group.ts)
 * (in reading order, wrapping at the ends), so a keyboard user does not have to Tab through every row.
 * ⚠️ No open/close height animation: a panel opens at once.
 * `data-slot` marks only the header and the panel, the two hooks globals.css needs (the footer, `#app-footer`, hides the header
 * and forces the panel open from 40rem); the home page draws 17 rows, and its HTML weight is an owner target.
 */
const TRIGGER = 'data-disclosure-trigger'
// The group marker (DISCLOSURE_GROUP) lives in ./disclosure-group.ts, a plain module, because a Server Component spreads it too.
// ⛔ Not re-exported from here: through this 'use client' module it would reach a Server Component as a proxy.

function moveFocus(e: KeyboardEvent<HTMLButtonElement>) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) || e.altKey || e.ctrlKey || e.metaKey) return
  const scope = e.currentTarget.closest('[data-disclosure-group]')
  if (!scope) return
  const all = [...scope.querySelectorAll<HTMLButtonElement>(`[${TRIGGER}]`)]
  const at = all.indexOf(e.currentTarget)
  if (at < 0 || all.length < 2) return
  e.preventDefault()
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (at + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length
  all[next].focus()
}

export function DisclosureItem({ trigger, children, level = 3, headingId, lead, className, triggerClassName, collapse = 'until-found' }: {
  /** The heading's text: what the button says. */
  trigger: ReactNode
  /** The panel's content. */
  children: ReactNode
  /** The heading's level: 2 for a page's own sections (the home FAQ), 3 inside one (the footer's link groups). */
  level?: 2 | 3
  /** The heading's id, for a link to the row (the home FAQ's `#about-…`). Generated when unset. */
  headingId?: string
  /** Drawn first in the row, before the heading (the footer's static sm+ heading). */
  lead?: ReactNode
  className?: string
  triggerClassName?: string
  /**
   * How a closed panel is kept out of view.
   *   · 'until-found' (the default; the home FAQ): `hidden`, upgraded to `until-found` after hydration, so find-in-page opens it.
   *   · 'below-sm' (the footer's link groups): NO `hidden` attribute at any time. The panel is in the HTML and displayed; only
   *     a phone collapses it, by CSS (globals.css, `[data-collapse=below-sm]:not([data-open])` under 40rem). ⛔ For crawlers:
   *     Seobility, like other crawlers that skip links under `hidden` (until-found included), did not count the footer's
   *     links (crawl 7, 2026-11-25: /help at click depth 3, every footer-only page deeper than it should be). The trade:
   *     on a phone, find-in-page does not reach a closed group's links (a CSS-hidden element is not searched).
   */
  collapse?: 'until-found' | 'below-sm'
}) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const ownId = useId()
  const hid = headingId ?? ownId
  const panel = useRef<HTMLDivElement>(null)
  const cssOnly = collapse === 'below-sm'
  useEffect(() => {
    const el = panel.current
    if (!el || open || cssOnly) return
    el.setAttribute('hidden', 'until-found')
    const onMatch = () => setOpen(true)
    el.addEventListener('beforematch', onMatch)
    return () => el.removeEventListener('beforematch', onMatch)
  }, [open, cssOnly])
  const Heading = level === 2 ? 'h2' : 'h3'
  return (
    <div className={cn('border-b border-border last:border-b-0', className)}>
      {lead}
      <Heading id={hid} data-slot="disclosure-header" className="flex">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          data-panel-open={open ? '' : undefined}
          {...{ [TRIGGER]: '' }}
          onClick={() => setOpen((was) => !was)}
          onKeyDown={moveFocus}
          className={cn('acc-trigger group/acc-trigger', triggerClassName)}
        >
          {trigger}
          <ChevronDown aria-hidden className="acc-chevron" />
        </button>
      </Heading>
      <div
        id={panelId}
        ref={panel}
        role="region"
        aria-labelledby={hid}
        data-slot="disclosure-panel"
        data-collapse={cssOnly ? 'below-sm' : undefined}
        data-open={cssOnly && open ? '' : undefined}
        hidden={cssOnly ? undefined : !open}
      >
        {children}
      </div>
    </div>
  )
}
