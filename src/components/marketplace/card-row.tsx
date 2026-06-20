'use client'

import { useRef, useState, useEffect, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { SerializedListing } from '@/lib/types'
import { cn } from '@/lib/utils'
import { ListingCard } from './listing-card'

type Props = {
  title: ReactNode
  listings: SerializedListing[]
  onOpen: (l: SerializedListing) => void
  onViewAll?: () => void
  viewAllLabel?: ReactNode
}

/** Airbnb-style horizontally-scrolling row of listing cards with snap + arrows. */
export function CardRow({ title, listings, onOpen, onViewAll, viewAllLabel }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const sectionRef = useRef<HTMLElement>(null)
  // Reveal-on-scroll via IntersectionObserver + CSS (replaces framer whileInView).
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = sectionRef.current
    if (!el) return
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setInView(true); io.disconnect() } },
      { rootMargin: '-80px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const scroll = (dir: 1 | -1) => {
    const el = ref.current
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' })
  }

  if (listings.length === 0) return null

  return (
    <section
      ref={sectionRef}
      className={cn(
        'space-y-3 transition-all duration-500 ease-out motion-reduce:transition-none',
        inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3.5',
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="h-section text-slate-800 dark:text-slate-100">{title}</h2>
        <div className="flex items-center gap-2 shrink-0">
          {onViewAll && (
            <button
              onClick={onViewAll}
              className="text-sm font-semibold text-[#0a66c2] hover:underline cursor-pointer whitespace-nowrap"
            >
              {viewAllLabel} →
            </button>
          )}
          <div className="hidden sm:flex items-center gap-1">
            <button
              onClick={() => scroll(-1)}
              aria-label="Scroll left"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-[#475569] shadow-sm transition-colors hover:bg-slate-50 cursor-pointer"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => scroll(1)}
              aria-label="Scroll right"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-[#475569] shadow-sm transition-colors hover:bg-slate-50 cursor-pointer"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <div
        ref={ref}
        className="flex gap-4 overflow-x-auto scroll-thin snap-x snap-mandatory pb-1 -mx-1 px-1"
      >
        {listings.map((l, i) => (
          <div key={l.id} className="w-[180px] sm:w-[220px] shrink-0 snap-start">
            <ListingCard listing={l} onOpen={onOpen} priority={i < 4} sizes="(max-width: 640px) 180px, 220px" />
          </div>
        ))}
      </div>
    </section>
  )
}
