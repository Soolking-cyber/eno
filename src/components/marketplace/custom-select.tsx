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

/** Pill-styled select whose menu is portaled to <body> so the horizontally
 *  scrolling facet row can't clip it. Props-only; no app context coupling. */
export function CustomSelect({
  value,
  onChange,
  options,
  placeholder,
  className,
  activeClassName,
  icon,
  wrapperClassName,
  labelClassName,
}: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; minWidth: number }>({ top: 0, left: 0, minWidth: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setMounted(true) }, [])

  // Position the portaled menu under the trigger (fixed coords, viewport-clamped).
  const reposition = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const menuW = Math.min(288, Math.max(r.width, 176))
    const left = Math.min(r.left, window.innerWidth - menuW - 8)
    setPos({ top: r.bottom + 8, left: Math.max(8, left), minWidth: r.width })
  }, [])

  useEffect(() => {
    if (!isOpen) return
    reposition()
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node
      if (containerRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setIsOpen(false)
    }
    // Reposition while open so the menu stays glued to the trigger (the facet row
    // scrolls horizontally; the page can scroll vertically).
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

  const selectedOption = options.find(o => o.value === value)

  return (
    <div ref={containerRef} className={cn('relative', wrapperClassName ?? 'w-full')}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => { if (!isOpen) reposition(); setIsOpen((o) => !o) }}
        className={cn(
          "flex w-full items-center justify-between rounded-full px-3.5 py-2 text-sm font-semibold outline-none transition-colors cursor-pointer",
          value !== 'all' && value !== 'newest'
            ? (activeClassName ?? "bg-[#e8f1fb] text-[#0a66c2]")
            : "bg-[#f1f5f9] text-[#475569] hover:bg-[#e8f1fb] hover:text-[#0a66c2]",
          className
        )}
      >
        <span className="flex items-center gap-1.5 truncate">
          {icon}
          <span className={cn('truncate', labelClassName)}>{selectedOption ? selectedOption.label : placeholder}</span>
        </span>
        <ChevronDown className={cn("h-3.5 w-3.5 text-slate-600 transition-transform shrink-0 ml-1.5", isOpen && "rotate-180")} />
      </button>

      {/* Menu is portaled to <body> so the overflow-x scroll row can't clip it. */}
      {isOpen && mounted && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: pos.minWidth }}
          className="z-[100] w-max max-w-[18rem] overflow-hidden rounded-2xl border border-slate-200/70 bg-white p-1.5 shadow-[0_8px_30px_rgba(0,0,0,0.08)] max-h-60 overflow-y-auto scroll-thin animate-in fade-in slide-in-from-top-1 duration-75"
        >
          {options.map((opt) => {
            const isActive = opt.value === value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value)
                  setIsOpen(false)
                }}
                className={cn(
                  'flex w-full items-center gap-6 rounded-lg px-3 py-2 text-left text-sm transition-colors cursor-pointer',
                  isActive
                    ? 'bg-[#e8f1fb] text-[#0a66c2] font-semibold'
                    : 'font-medium text-[#475569] hover:bg-[#f1f5f9]'
                )}
              >
                <span className="whitespace-nowrap">{opt.label}</span>
              </button>
            )
          })}
        </div>,
        document.body,
      )}
    </div>
  )
}
