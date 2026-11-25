'use client'

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ChevronDown } from '@/components/ui/icons'

/**
 * ONE HOME QUESTION: the WAI-ARIA disclosure pattern — an `<h2>` holding a `<button aria-expanded>`, and its answer in a
 * panel the button controls. The markup and classes are ui/accordion's (`acc-trigger`, `acc-chevron`, which turns on
 * `data-panel-open`), so it looks the same.
 *
 * ⛔ HAND-ROLLED ON PURPOSE (CLAUDE.md: Base UI first, then a purpose-built library, hand-rolled last, with the reason).
 * 2026-11-25, measured on the phone home (local profiling build, Lighthouse with real throttling):
 *   · Base UI Accordion / Collapsible — RULED OUT. Its panel reads getComputedStyle in a layout effect on mount, then
 *     writes `hidden="until-found"`, which forces a full-page style pass per panel (17 questions: 254 + 52 ms of the worst
 *     long task at 4× CPU). Its CompositeList then registers every item in a layout effect: a sync re-render, which also
 *     drags hydration's effects into the same task.
 *   · Native `<details>` — RULED OUT. The question must stay an H2 in its row, and inside `<summary>` (exposed as a
 *     button in several browser + screen-reader pairs) an H2 can be flattened, so heading navigation would skip the FAQ
 *     (commit gate).
 *   · No library fills the gap: this is one state and one button.
 * The closed answer is in the server's HTML as `hidden`, since React writes that attribute only as a boolean. After
 * hydration, one effect upgrades it to `until-found`: a single write, no style read. Find-in-page then reaches every
 * answer, and the browser's `beforematch` opens the item that holds a match.
 * ↑ / ↓ / Home / End move between the questions as Base UI's accordion did: across both columns in reading order, wrapping
 * at the ends (commit gate: a keyboard user must not have to Tab through 17 rows).
 */
const TRIGGER = 'data-faq-trigger'
function moveFocus(e: KeyboardEvent<HTMLButtonElement>) {
  const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End']
  if (!keys.includes(e.key) || e.altKey || e.ctrlKey || e.metaKey) return
  const all = [...(e.currentTarget.closest('section') ?? document).querySelectorAll<HTMLButtonElement>(`[${TRIGGER}]`)]
  const at = all.indexOf(e.currentTarget)
  if (at < 0 || all.length < 2) return
  e.preventDefault()
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (at + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length
  all[next].focus()
}
export function FaqItem({ id, question, children }: { id: string; question: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = panel.current
    if (!el || open) return
    el.setAttribute('hidden', 'until-found')
    const onMatch = () => setOpen(true)
    el.addEventListener('beforematch', onMatch)
    return () => el.removeEventListener('beforematch', onMatch)
  }, [open])
  return (
    <div className="border-b border-border last:border-b-0">
      <h2 id={`about-${id}`} className="flex">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          data-panel-open={open ? '' : undefined}
          {...{ [TRIGGER]: '' }}
          onClick={() => setOpen((was) => !was)}
          onKeyDown={moveFocus}
          className="acc-trigger group/acc-trigger py-2.5 text-sm"
        >
          {question}
          <ChevronDown aria-hidden className="acc-chevron" />
        </button>
      </h2>
      <div id={panelId} ref={panel} role="region" aria-labelledby={`about-${id}`} hidden={!open}>
        {children}
      </div>
    </div>
  )
}
