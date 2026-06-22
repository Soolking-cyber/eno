'use client'

import { useEffect, useState } from 'react'
import { ArrowUp } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Subtle floating "back to top" — fades in after scrolling down, bottom-right,
 *  above the mobile bottom-nav. Smooth-scrolls the page to the top. */
export function BackToTop() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 700)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <button
      type="button"
      aria-label="Back to top"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      className={cn(
        'fixed right-4 z-40 flex h-10 w-10 items-center justify-center rounded-full',
        'border border-border bg-card/90 text-body shadow-pop backdrop-blur',
        'transition-all duration-200 hover:bg-muted hover:text-foreground active:scale-95',
        'bottom-[calc(5rem+env(safe-area-inset-bottom))] lg:bottom-6', // clear the mobile bottom-nav
        show ? 'opacity-100 translate-y-0' : 'pointer-events-none opacity-0 translate-y-2',
      )}
    >
      <ArrowUp className="h-5 w-5" strokeWidth={2.75} />
    </button>
  )
}
