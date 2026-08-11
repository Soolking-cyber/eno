import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { STROKE_DISPLAY } from '@/lib/icon-tokens'

// Shared centered empty / error placeholder: the dashed-border card (icon or media + title
// + optional subtitle + optional action) that was hand-rolled in ~14 places — empty lists,
// failed fetches (icon + message + retry button), and "nothing here yet" notices.
// No 'use client' / no hooks → usable from server and client components alike.
//
//   tone: 'default' = dashed border (marketplace surfaces)
//         'admin'   = solid border
//         'bare'    = no border, no card — just the centered stack. This is what the
//                     mascot-led empty states need: they were hand-rolled only because
//                     this primitive could not take anything but a lucide icon, and
//                     boxing them in the dashed card would be a visible change.
//
//   media: an arbitrary node rendered ABOVE the title, in place of the icon — e.g.
//          <Mascot name="chat" className="h-40 w-40" />. When `media` is set, `icon` is
//          ignored. The node is rendered VERBATIM (never cloned, never given a className):
//          sizing/colour stay entirely with the caller, so nothing here can collide with
//          the caller's classes. Media that should be centered must center itself the way
//          it already does today (mx-auto), which the flex column also does for free.
//
//   variant: 'empty' = nothing here yet · 'fault' = something failed. See the coin note
//            at the render — this is a colour + mascot policy, not a layout change.
export function EmptyState({
  icon: Icon,
  media,
  title,
  subtitle,
  action,
  tone = 'default',
  size = 'default',
  variant = 'empty',
  className,
}: {
  media?: React.ReactNode
  title: React.ReactNode
  subtitle?: React.ReactNode
  action?: React.ReactNode
  tone?: 'default' | 'admin' | 'bare'
  // 'lg' = statement tier for mascot-led, page-level empty states (guest gates, empty
  // categories): the title steps up a size so a 160px mascot doesn't dwarf its own caption.
  // Inline list/table empties stay on the default.
  size?: 'default' | 'lg'
  className?: string
} & (
  /**
   * ⚠️ AN ERROR IS NOT AN EMPTY, AND THIS PRIMITIVE RENDERS BOTH — the header above says
   * so in its own first sentence: "empty lists, failed fetches (icon + message + retry
   * button), and 'nothing here yet' notices" (icon-language §6 amendment, 2026-08-11).
   * With a single hardcoded coin, every failure painted itself on the brand's warm
   * `bg-brand-50` disc in `text-brand` ink — the foundation's *warm-empty* move, fired at
   * the exact moment the product had let the user down. 'fault' swaps the coin for the
   * NEUTRAL disc with the fault ink on the glyph. It is `'empty' | 'fault'`, not a boolean
   * `error`, because §6 sanctions exactly two coins and the type should say so.
   *
   * ⚠️ THE UNION IS LOAD-BEARING: `variant='fault'` REQUIRES `icon` AND FORBIDS `media`.
   * The fault branch refuses mascots by design (see the render), so `icon` is the only
   * thing left to draw — optional `icon` would have rendered a silent blank where the coin
   * belongs, and an accepted-then-discarded `media` would silently delete a caller's art
   * on the migration this amendment is asking for. Both holes were found by reviewers on
   * the first draft. `media?: never` and a required `icon` make them unrepresentable,
   * which is cheaper than a comment asking every call site to remember.
   */
  | { variant?: 'empty'; icon?: LucideIcon }
  | { variant: 'fault'; icon: LucideIcon; media?: never }
)) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-4',
        tone !== 'bare' && 'rounded-2xl border',
        'px-6 py-14 text-center',
        tone === 'admin' ? 'border-border' : tone === 'default' && 'border-dashed border-line-strong',
        className,
      )}
    >
      {/* THE TWO SANCTIONED COINS (icon-language §6). Same disc, same display stroke, two
          inks — there is no third recipe anywhere in the app:
            · chrome ('empty') — soft `bg-brand-50` + `text-brand`. The same blue family as
              the category fill, so "nothing here yet" looks like eno rather than a gray
              void. Mascot `media` renders verbatim instead (bespoke art needs no coin).
            · fault  ('fault') — NEUTRAL `bg-secondary` + `text-destructive`. The disc stays
              neutral deliberately: the INK carries the fault, and a red halo behind a
              retryable fetch error shouts louder than the error deserves. The ink is
              FIXED at destructive because this primitive only ever renders a failure;
              §6's other fault ink (`text-warning`, for a caution) belongs to banner-scale
              coins like enforcement-banner's, not here.
              ⚠️ `bg-secondary`, NOT `bg-tint` — measured, because the first draft used tint
              and a reviewer was right about it. Light `--tint #f5f5f5` against `--card`/
              `--background #fafafa` is a ~2% step, so on a card (or a row that hovers to
              solid card) the disc IS the surface and the coin stops being a container.
              `--secondary` is #e5e5e5 / #303030 — a firm step on canvas AND on card, in
              both themes. A fault should read as a definite object, not a whisper.
          ⚠️ `variant='fault'` IGNORES `media`, AND THAT IS THE POINT, NOT AN OVERSIGHT. The
          mascots are the warm-empty voice; on a failure they read as the product being
          pleased with itself, so the canon says no mascot on an error. Enforcing it in the
          primitive rather than trusting every call site is what makes it true, and the
          props union guarantees the coin can still draw (fault REQUIRES `icon`, so there
          is no combination that renders blank here). A caller that genuinely wants bespoke
          art on a failure wants a different component. */}
      {variant === 'fault'
        ? (Icon && (
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-secondary">
              <Icon className="h-8 w-8 text-destructive" strokeWidth={STROKE_DISPLAY} />
            </span>
          ))
        : media ?? (Icon && (
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-50">
              <Icon className="h-8 w-8 text-brand" strokeWidth={STROKE_DISPLAY} />
            </span>
          ))}
      <div className="space-y-1">
        <p className={size === 'lg' ? 'text-base font-semibold text-foreground' : 'text-sm font-semibold text-body'}>{title}</p>
        {subtitle && <p className={cn('mx-auto max-w-sm text-muted-foreground', size === 'lg' ? 'text-sm' : 'text-xs')}>{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}
