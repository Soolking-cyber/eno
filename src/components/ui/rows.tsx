import { cn } from '@/lib/utils'

// ── Rows — a LIST SEPARATED BY LINES, not a card containing a list ───────────────────
//
// The flat design language (owner 2026-07-24: "minimal boxes as much as open borders with lines
// between elements … background color as uniform as possible almost no boxes";
// docs/flat-surface-plan.md). This is the shape that replaces
// `rounded-2xl border border-border bg-card` wrapped around a stack of items.
//
// WHAT IT DELIBERATELY HAS NOT GOT: no fill, no outer border, no radius, no shadow. Separation
// is a hairline between siblings and nothing else. `--card` is now identical to `--background`,
// so a fill would be invisible anyway — and adding a second panel colour to "get depth back" is
// exactly the faint-box look this replaces (codex, plan review).
//
// ⚠️ THE GROUPING MUST SURVIVE THE FLATTENING. Removing a border removes a VISUAL group, so the
// semantic one has to be real: `Rows` renders a <ul>/<li> by default and `RowsSection` pairs a
// heading with the list. Both reviewers raised this independently — on a flat canvas, structure
// that exists only in the paint is structure a screen reader never had.
//
// ⚠️ NOT FOR THINGS THAT FLOAT. Dialogs, popovers, menus, toasts, sticky bars and the lightbox
// keep their elevated surface: there the boundary IS the information. Flatten what sits in the
// page, never what sits above it.

export function Rows({
  as: As = 'ul',
  bordered = false,
  className,
  children,
}: {
  /** 'ul' (default) keeps list semantics. Use 'div' only when the children are not a list. */
  as?: 'ul' | 'div'
  /** Add the top/bottom hairlines too — for a list that needs closing off against neighbouring
   *  content rather than sitting inside an already-ruled section. */
  bordered?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <As
      className={cn(
        'divide-y divide-border',
        bordered && 'border-y border-border',
        className,
      )}
    >
      {children}
    </As>
  )
}

/** One row. `<li>` under the default `Rows`; pass `as="div"` when the parent is a div. */
export function Row({
  as: As = 'li',
  className,
  children,
}: {
  as?: 'li' | 'div'
  className?: string
  children: React.ReactNode
}) {
  // py-3 puts an ordinary row comfortably past the 48px tap floor on its own.
  // ⚠️ Do NOT reach for `tap-44`/`tap-48` to "make sure": those grow an absolutely-positioned
  // ::before sized to the nearest POSITIONED ancestor, so on an unpositioned row every row's
  // hit layer covers the whole list and the last one swallows every tap (shipped and fixed
  // 2026-07-24, a053e5d5). Give the row real height instead.
  return <As className={cn('py-3', className)}>{children}</As>
}

/**
 * A titled block on the flat canvas: a caption, its content, and a hairline ABOVE separating it
 * from whatever came before — the "open border" the owner asked for, instead of a box drawn
 * around everything.
 *
 * `first` drops the leading rule so the top of a page does not open with a stray line.
 */
export function RowsSection({
  caption,
  first = false,
  className,
  children,
}: {
  caption?: string
  first?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={cn(!first && 'mt-6 border-t border-border pt-6', className)}>
      {caption && (
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-4">{caption}</h2>
      )}
      <div className={cn(caption && 'mt-2')}>{children}</div>
    </section>
  )
}
