'use client'

import { useEffect, useState } from 'react'
import { Tr } from '@/context/language-context'
import { Bilingual } from './bilingual'
import { cn } from '@/lib/utils'

export type RailSection = { id: string; label: string; labelVi?: string }

/**
 * The lg+ "On this page" links of ContentPage, with a scroll-spy: the section being read carries
 * `aria-current="location"` and the tint, so the rail answers "where am I" and not only "what is
 * here" (C-TOC, 2026-09-29).
 *
 * ⚠️ THE ONLY CLIENT CODE IN THE CONTENT-PAGE FAMILY, AND IT RENDERS THE SAME ANCHORS THE SERVER
 * RAIL DID. The server HTML is the full list of plain `<a href="#id">` links, so a crawler, a
 * no-JS reader and the first paint are unchanged; the observer only adds the current-section mark
 * once it has run. `activeId` starts null on BOTH sides of hydration, so the markup cannot differ.
 *
 * The band is the strip just under the sticky header (96px, the rail's own `top-24`) down to a
 * third of the viewport: the section crossing it is the one being read. When nothing crosses it
 * (a gap between two sections), the last answer stands rather than blinking to nothing.
 */
export function ContentRail({ sections }: { sections: RailSection[] }) {
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    const targets = sections
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => el !== null)
    if (!targets.length || typeof IntersectionObserver === 'undefined') return
    const crossing = new Set<string>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) crossing.add(e.target.id)
          else crossing.delete(e.target.id)
        }
        // Document order, not callback order: two sections can cross the band at once, and the
        // one higher on the page is the one whose heading the reader has passed.
        const first = targets.find((t) => crossing.has(t.id))
        if (first) setActiveId(first.id)
      },
      { rootMargin: '-96px 0px -66% 0px', threshold: 0 },
    )
    for (const t of targets) observer.observe(t)
    return () => observer.disconnect()
  }, [sections])

  return (
    <>
      {sections.map((s) => {
        const active = s.id === activeId
        return (
          <a
            key={s.id}
            href={`#${s.id}`}
            aria-current={active ? 'location' : undefined}
            // ⚠️ INK AND TINT MARK THE CURRENT SECTION, NOT WEIGHT: a bolder label is a wider label, so a
            // two-word entry could wrap and shove every link below it as the reader scrolls.
            className={cn(
              'block rounded-lg px-2 py-1 text-sm font-medium transition-colors hover:bg-muted hover:text-foreground active:bg-muted',
              active ? 'bg-muted text-foreground' : 'text-muted-foreground',
            )}
          >
            {s.labelVi ? <Bilingual en={s.label} vi={s.labelVi} /> : <Tr text={s.label} />}
          </a>
        )
      })}
    </>
  )
}
