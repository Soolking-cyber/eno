import { ChevronsUpDown, ChevronDown } from '@/components/ui/icons'
import { cn } from '@/lib/utils'

/** The trigger's look, without Base UI: shared by CustomSelect and its stand-in, DeferredSelect, so the two cannot drift apart. */

/** From this many options a picker is the type-to-filter variant. */
export const SEARCHABLE_FROM = 6

/** The trigger's disclosure glyph — see `indicator`. Same 14px box either way, so no pill reflows. */
export function TriggerGlyph({ indicator = 'updown', open }: { indicator?: 'updown' | 'down'; open: boolean }) {
  if (indicator === 'down') {
    return <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 ml-1.5 text-ink-4 transition-transform', open && 'rotate-180')} />
  }
  return <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 ml-1.5 text-ink-4" />
}

/** The trigger's box. Shared verbatim by both variants so the searchable picker is
 *  pixel-identical to the plain one — a facet row must not visibly reflow just because
 *  one of its filters gained a sixth option. */
export function triggerClassName(
  open: boolean,
  value: string,
  activeClassName: string | undefined,
  className: string | undefined,
) {
  return cn(
    // h-12 (48px) default — kid-friendly filter target across every call site (facet
    // bar, explorer filters, area picker). A caller that sets its own height still wins
    // (its className lands after this in the cn). px-4 for generous horizontal room.
    'flex min-h-12 w-full items-center justify-between gap-0 px-4 text-sm font-semibold outline-none transition-colors duration-150 cursor-pointer active:scale-100',
    // Closed: consistent rounded-xl (no more pills). Caller className may restyle.
    !open && 'rounded-xl',
    // Open: flatten. The base carries rounded-xl unconditionally, so the open
    // state must say rounded-none out loud — and it stays BEFORE `className` so a
    // caller that hard-sets its own radius (area-filter's FIELD) still wins.
    open && 'rounded-none',
    !open && (value !== 'all' && value !== 'newest'
      ? (activeClassName ?? 'bg-accent text-accent-foreground')
      : 'text-body hover:bg-muted'), // flush at rest, color on hover (one-canvas)
    className,
    // Open: just emphasize the text; the menu is a detached card below
    // (consistent with every other dropdown — no morph).
    open && 'text-foreground',
  )
}
