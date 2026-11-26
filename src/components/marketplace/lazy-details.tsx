'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * A `<details>` whose body is mounted the first time it opens, then kept. For a phone-only copy of something the page already
 * shows elsewhere: SeoArticle's phone "On this page" row repeats the desktop rail's links, and the two lists in one page's HTML
 * were Seobility's "duplicate paragraphs" on every long guide (crawl 10, 2026-11-26). The rail stays in the server HTML for
 * crawlers; this copy arrives when a reader asks for it.
 * ⚠️ Opened before hydration (a fast tap on a slow phone): the effect sees the element already open and mounts the body then.
 */
export function LazyDetails({ summary, children, className }: { summary: ReactNode; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDetailsElement>(null)
  const [opened, setOpened] = useState(false)
  useEffect(() => {
    if (ref.current?.open) setOpened(true)
  }, [])
  return (
    <details ref={ref} className={className} onToggle={(e) => { if (e.currentTarget.open) setOpened(true) }}>
      {summary}
      {opened ? children : null}
    </details>
  )
}
