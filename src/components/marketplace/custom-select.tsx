'use client'

import { useCallback, useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
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
}

/** Select whose menu MORPHS out of the trigger (Google-style): on open the trigger
 *  flattens its bottom and the menu attaches directly below as one continuous white
 *  window (same width, shared border + shadow, faint divider). Menu is portaled to
 *  <body> so a scrolling facet row can't clip it. Props-only; no app coupling. */
export function CustomSelect({
  value, onChange, options, placeholder, className, activeClassName, icon, wrapperClassName, labelClassName,
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
    setPos({ top: r.bottom, left: Math.max(8, left), width })
  }, [])

  useEffect(() => {
    if (!isOpen) return
    reposition()
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node
      if (containerRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setIsOpen(false)
    }
    const onScroll = () => reposition()
    document.addEventListener('mousedown', onDocClick)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
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
          'flex w-full items-center justify-between px-3.5 py-2 text-sm font-semibold outline-none transition-colors cursor-pointer border',
          // Closed: consistent rounded-xl (no more pills). Caller className may restyle.
          !isOpen && 'rounded-xl border-transparent',
          !isOpen && (value !== 'all' && value !== 'newest'
            ? (activeClassName ?? 'bg-accent text-accent-foreground')
            : 'bg-tint text-body hover:bg-accent hover:text-accent-foreground'),
          className,
          // Open: morph into the top of the window (overrides caller styling).
          isOpen && 'rounded-t-2xl rounded-b-none border-border border-b-transparent bg-card text-foreground shadow-pop',
        )}
      >
        <span className="flex items-center gap-1.5 truncate">
          {icon}
          <span className={cn('truncate', labelClassName)}>{selectedOption ? selectedOption.label : placeholder}</span>
        </span>
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 ml-1.5 text-slate-600 transition-transform', isOpen && 'rotate-180')} />
      </button>

      {isOpen && mounted && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width }}
          className="z-[100] max-h-60 overflow-y-auto overflow-x-hidden rounded-b-2xl border border-t-border border-border bg-card p-1.5 shadow-pop scroll-thin animate-in fade-in slide-in-from-top-1 duration-100"
        >
          {options.map((opt) => {
            const isActive = opt.value === value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(opt.value); setIsOpen(false) }}
                className={cn(
                  'flex w-full items-center gap-6 rounded-lg px-3 py-2 text-left text-sm transition-colors cursor-pointer',
                  isActive ? 'bg-accent text-accent-foreground font-semibold' : 'font-medium text-body hover:bg-tint',
                )}
              >
                <span className="truncate">{opt.label}</span>
              </button>
            )
          })}
        </div>,
        document.body,
      )}
    </div>
  )
}
