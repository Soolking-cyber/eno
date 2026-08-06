import type { ReactNode } from 'react'
import { Header } from './header'
import { Footer } from './footer'
import { Tr } from '@/context/language-context'
import { cn } from '@/lib/utils'

// ── Content-page chunk system (help/safety/trust/privacy/terms/about/guide) ─────────
// One plug-and-play layout for every text page, at the SAME canonical width as the
// rest of the app (max-w-7xl px-3 sm:px-6 lg:px-8 — logo edge to Post-a-listing edge).
// The article hero is ONE treatment for the whole family: balanced title, measured
// lede, then a single hairline before the body — statement by type + spacing, never
// by a panel. lg+: a sticky "On this page" rail on the left, chunked content on the
// right; below lg it stacks. Chunks are BORDERLESS (one-canvas design language):
// separation is spacing + headings only, never boxes. Body copy inside a chunk stays
// capped at a readable measure (70ch, the 65–75ch craft floor) — wide layout,
// readable lines — while grids (tip tiles, step cards) may opt into the full column
// with `wide`. Server components — zero client JS; anchors are plain links.

export function ContentPage({ title, meta, intro, sections, children }: {
  // Pure-label kickers are banned (craft floor); the last caller's eyebrow was deleted
  // with the slot itself so it can't quietly come back.
  title: string
  /** Small line under the title (e.g. "Last updated …"). */
  meta?: ReactNode
  intro?: ReactNode
  /** lg+ left-rail anchors; omit for single-section pages. */
  sections?: { id: string; label: string }[]
  children: ReactNode
}) {
  const hasRail = !!sections?.length
  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-3 sm:px-6 lg:px-8 pt-8 sm:pt-12 pb-16">
        <header className="border-b border-border pb-8">
          <h1 className="h-display max-w-4xl text-balance text-foreground"><Tr text={title} /></h1>
          {meta}
          {intro && <p className="mt-4 max-w-[70ch] text-base leading-relaxed text-body">{intro}</p>}
        </header>
        <div className={cn('mt-10', hasRail && 'lg:grid lg:grid-cols-[210px_minmax(0,1fr)] lg:gap-12')}>
          {hasRail && (
            <nav aria-label="On this page" className="hidden lg:block">
              <div className="sticky top-24 space-y-0.5">
                <p className="eyebrow mb-2 text-ink-4"><Tr text="On this page" /></p>
                {sections!.map((s) => (
                  <a key={s.id} href={`#${s.id}`} className="block rounded-lg px-2 py-1 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                    <Tr text={s.label} />
                  </a>
                ))}
              </div>
            </nav>
          )}
          <div className="min-w-0 space-y-12">{children}</div>
        </div>
      </main>
      <Footer />
    </div>
  )
}

export function ContentSection({ id, title, wide = false, children }: {
  id?: string
  title?: string
  /** true → children (grids/tiles) span the full column; default caps text at 70ch. */
  wide?: boolean
  children: ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-24">
      {title && <h2 className="h-section text-foreground"><Tr text={title} /></h2>}
      <div className={cn('space-y-3', title && 'mt-3', !wide && 'max-w-[70ch]')}>{children}</div>
    </section>
  )
}
