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
          {/* ⚠️ The rail names itself with aria-labelledBY, not aria-label. This is a SERVER
              component, so there is no `tr()` in scope for an attribute string — and the rail
              already renders those very words, translated, as its visible heading. Pointing the
              landmark at that heading gives it a name in the viewer's language for free and keeps
              the accessible name identical to the visible one, which a hardcoded English
              aria-label stopped doing the moment the heading swapped out of English.
              NOT a CSS/test hook: the one aria-label selector in the codebase is globals.css's
              `nav[aria-label="breadcrumb" i]` (it hides breadcrumbs in the native app) — read the
              note there before renaming any other nav. */}
          {hasRail && (
            <nav aria-labelledby="on-this-page" className="hidden lg:block">
              <div className="sticky top-24 space-y-0.5">
                <p id="on-this-page" className="eyebrow mb-2 text-ink-4"><Tr text="On this page" /></p>
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
      {/**
        * ⛔ THE CAP IS ON THE CHILDREN, NOT ON THIS WRAPPER, BECAUSE `ch` RESOLVES AGAINST THE
        * ELEMENT THAT DECLARES IT. On the wrapper it inherited 16px (1ch = 10px), so
        * `max-w-[70ch]` computed to a flat 700px — and the copy inside is smaller: `text-sm`
        * (1ch = 8.75px) rendered 80ch and `text-xs` (1ch = 7.5px) rendered 93ch, against the
        * 65–75ch measure this cap exists to hold. Measured across 10 content routes: 79 of 215
        * text blocks were over 75ch, the longest line 106 characters.
        * ✅ On the children it resolves per element: 612px for 14px copy, 525px for 12px copy —
        * both exactly 70ch, which is what the class always claimed.
        * ⛔ `[&_p]` (DESCENDANT), NOT `[&>p]` (CHILD) — I shipped the child version first and it was
        * WORSE than the bug: most paragraphs on these pages are nested inside sub-wrappers, so they
        * matched nothing and lost the cap altogether. Measured on /regulations: 107 of 109 blocks
        * over 75ch, longest 109ch, against 79 of 215 before the change. The scope has to be every
        * descendant — the same reach the wrapper cap had; the only thing changing is WHERE `ch`
        * resolves.
        * ⚠️ THE WRAPPER CAP STAYS TOO, and dropping it was a regression a reviewer caught: every
        * block that is not a `p` or an `li` — tables, callouts, figures — lost its only bound and
        * ran the full container width. Keeping both means text resolves `ch` against its own size
        * (612px at 14px, 525px at 12px) while everything else keeps the 700px it always had.
        * ⚠️ `/terms` already did it this way; this brings the shared component in line.
        */}
      <div className={cn('space-y-3', title && 'mt-3', !wide && 'max-w-[70ch] [&_p]:max-w-[70ch] [&_li]:max-w-[70ch]')}>{children}</div>
    </section>
  )
}
