'use client'

import { useCallback, useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Check } from 'lucide-react'
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
      <button
        ref={triggerRef}
        type="button"
        onClick={() => { if (!isOpen) reposition(); setIsOpen((o) => !o) }}
        className={cn(
          'flex w-full items-center justify-between px-3.5 py-2 text-sm font-semibold outline-none transition-colors cursor-pointer',
          // Closed: consistent rounded-xl (no more pills). Caller className may restyle.
          !isOpen && 'rounded-xl',
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
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 ml-1.5 text-ink-4 transition-transform', isOpen && 'rotate-180')} />
      </button>

      {isOpen && mounted && createPortal(
        <>
        {/* Transparent backdrop: it's the tap target, so an outside tap CLOSES the
            menu and is absorbed here — never passing through to a card/button below
            (the old mousedown-close let the click land on the element underneath). */}
        <div className="fixed inset-0 z-[120]" aria-hidden onClick={() => setIsOpen(false)} />
        <div
          ref={menuRef}
          data-portal-menu
          // Hidden until positioned so it never paints at (0,0) and "flies in" from the
          // top-left on the first frame (pos is computed in an effect after open).
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, visibility: pos.top > 0 ? 'visible' : 'hidden' }}
          className="z-[121] max-h-60 overflow-y-auto overflow-x-hidden rounded-2xl bg-card p-1.5 shadow-pop scroll-thin animate-in fade-in duration-150"
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
