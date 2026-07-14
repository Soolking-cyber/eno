'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** A "More +N" chip that reveals overflow items in a dropdown — opens on HOVER on
 *  desktop and on TAP on mobile. Portaled to <body> so it escapes the rails'
 *  overflow-x-auto clipping. Children are the overflow rows (the caller renders +
 *  wires their onClick); clicking inside closes the panel. */
export function MoreOverflow({ count, children, label }: { count: number; children: ReactNode; label?: string }) {
  const { tr } = useLanguage()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const place = () => {
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    const width = 248
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8))
    setPos({ top: r.bottom + 6, left, width })
  }
  const show = () => { clearTimeout(closeTimer.current); place(); setOpen(true) }
  const hideSoon = () => { clearTimeout(closeTimer.current); closeTimer.current = setTimeout(() => setOpen(false), 140) }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node) || panelRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    const reposition = () => place()
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [open])

  if (count <= 0) return null

  return (
    <>
      <Button
        variant="bare"
        size="none"
        ref={btnRef}
        type="button"
        onClick={() => (open ? setOpen(false) : show())}
        onMouseEnter={show}
        onMouseLeave={hideSoon}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          // active:scale-100 is load-bearing: this button is the popover anchor and
          // place() reads its getBoundingClientRect() — a press transform would move it.
          // justify-start likewise: the chip is w-full and its label must stay left-aligned.
          'inline-flex w-full shrink-0 items-center justify-start gap-1 whitespace-nowrap rounded-lg px-2.5 py-1 text-sm font-semibold transition-colors duration-150 active:scale-100 cursor-pointer tap-44 relative',
          open ? 'bg-card text-accent-foreground shadow-sm' : 'text-body hover:bg-card/70 hover:text-accent-foreground',
        )}
      >
        {label || tr('More', 'Thêm')}
        <span className="text-2xs font-bold text-ink-4">+{count}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-180')} />
      </Button>
      {open && pos && createPortal(
        <div
          ref={panelRef}
          onMouseEnter={show}
          onMouseLeave={hideSoon}
          onClick={() => setOpen(false)}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width }}
          className="z-[1100] max-h-[60vh] overflow-y-auto scroll-thin rounded-2xl bg-popover p-2 shadow-pop animate-in fade-in slide-in-from-top-1 duration-150"
        >
          <div className="flex flex-col gap-0.5">{children}</div>
        </div>,
        document.body,
      )}
    </>
  )
}
