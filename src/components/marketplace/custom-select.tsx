'use client'

import { useCallback, useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { ChevronsUpDown, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface CustomSelectProps {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  placeholder?: string
  className?: string
  activeClassName?: string
  icon?: React.ReactNode
  wrapperClassName?: string
  labelClassName?: string
  /** Override the trigger text (e.g. a short code) while the menu keeps full labels. */
  triggerLabel?: string
}

/** Select whose menu MORPHS out of the trigger (Google-style): on open the trigger
 *  flattens its bottom and the menu attaches directly below as one continuous white
 *  window (same width, shared border + shadow, faint divider). Menu is portaled to
 *  <body> so a scrolling facet row can't clip it. Props-only; no app coupling. */
export function CustomSelect({
  value, onChange, options, placeholder, className, activeClassName, icon, wrapperClassName, labelClassName, triggerLabel,
}: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setMounted(true) }, [])

  // Attach the menu flush under the trigger, exact same width → one window.
  const reposition = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const width = Math.max(r.width, 176) // keep narrow pills' menus readable
    const left = Math.min(r.left, window.innerWidth - width - 8)
    setPos({ top: r.bottom + 6, left: Math.max(8, left), width })
  }, [])

  useEffect(() => {
    if (!isOpen) return
    reposition()
    const onScroll = () => reposition()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsOpen(false) }
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    document.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
      document.removeEventListener('keydown', onKey)
    }
  }, [isOpen, reposition])

  const selectedOption = options.find((o) => o.value === value)

  return (
    <div ref={containerRef} className={cn('relative', wrapperClassName ?? 'w-full')}>
      {/* ui/button (variant="bare" size="none") owns nothing but focus ring + icon rule
          here; the box, colours and radius stay exactly as hand-rolled. Three base
          classes are deliberately neutralised in the className below:
            · gap-2      → gap-0   (the children carry their own margins: the label
                                    group has gap-1.5, the chevron has ml-1.5)
            · font-medium→ font-semibold, justify-center → justify-between, inline-flex
                           → flex, transition-all → transition-colors (all via cn/twMerge)
            · active:scale-[0.97] → active:scale-100. This trigger is a POPOVER ANCHOR:
                           reposition() reads getBoundingClientRect() on click and on
                           every scroll while open, and a transform scales that rect —
                           a pressed trigger would anchor the menu off by ~3%. It also
                           never had a press-scale before. Do not let the base scale back in. */}
      <Button
        ref={triggerRef}
        type="button"
        variant="bare"
        size="none"
        onClick={() => { if (!isOpen) reposition(); setIsOpen((o) => !o) }}
        className={cn(
          'flex w-full items-center justify-between gap-0 px-3.5 py-2 text-sm font-semibold outline-none transition-colors duration-150 cursor-pointer active:scale-100',
          // Closed: consistent rounded-xl (no more pills). Caller className may restyle.
          !isOpen && 'rounded-xl',
          // Open: flatten. The base carries rounded-xl unconditionally, so the open
          // state must say rounded-none out loud — and it stays BEFORE `className` so a
          // caller that hard-sets its own radius (area-filter's FIELD) still wins, as
          // it did when the open branch simply emitted no radius class at all.
          isOpen && 'rounded-none',
          !isOpen && (value !== 'all' && value !== 'newest'
            ? (activeClassName ?? 'bg-accent text-accent-foreground')
            : 'text-body hover:bg-muted'), // flush at rest, color on hover (one-canvas)
          className,
          // Open: just emphasize the text + rotate the chevron; the menu is a detached
          // card below (consistent with every other dropdown — no morph).
          isOpen && 'text-foreground',
        )}
      >
        <span className="flex items-center gap-1.5 truncate">
          {icon}
          <span className={cn('truncate', labelClassName)}>{triggerLabel ?? (selectedOption ? selectedOption.label : placeholder)}</span>
        </span>
        {/* Select-trigger convention (shadcn/macOS): stacked chevrons = value picker. */}
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 ml-1.5 text-ink-4" />
      </Button>

      {isOpen && mounted && createPortal(
        <>
        {/* Transparent backdrop: it's the tap target, so an outside tap CLOSES the
            menu and is absorbed here — never passing through to a card/button below
            (the old mousedown-close let the click land on the element underneath). */}
        <div className="fixed inset-0 z-[1200]" aria-hidden onClick={() => setIsOpen(false)} />
        <div
          ref={menuRef}
          data-portal-menu
          // Hidden until positioned so it never paints at (0,0) and "flies in" from the
          // top-left on the first frame (pos is computed in an effect after open).
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, visibility: pos.top > 0 ? 'visible' : 'hidden' }}
          className="z-[1201] max-h-60 overflow-y-auto overflow-x-hidden rounded-2xl bg-popover p-1.5 shadow-pop scroll-thin animate-in fade-in duration-150"
        >
          {options.map((opt) => {
            const isActive = opt.value === value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(opt.value); setIsOpen(false) }}
                className={cn(
                  'flex w-full items-center justify-between gap-6 rounded-lg px-3 py-2 text-left text-sm transition-colors cursor-pointer hover:bg-muted hover:text-accent-foreground',
                  isActive ? 'font-semibold text-accent-foreground' : 'font-medium text-body',
                )}
              >
                <span className="truncate">{opt.label}</span>
                {isActive && <Check className="h-4 w-4 shrink-0" />}
              </button>
            )
          })}
        </div>
        </>,
        document.body,
      )}
    </div>
  )
}
