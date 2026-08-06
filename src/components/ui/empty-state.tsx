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
export function EmptyState({
  icon: Icon,
  media,
  title,
  subtitle,
  action,
  tone = 'default',
  size = 'default',
  className,
}: {
  icon?: LucideIcon
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
}) {
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
      {/* The chrome coin (icon-language §6): a lucide-led empty state sits its glyph on a
          soft brand-50 disc at the display stroke — the same blue family as the category
          wash, so "nothing here yet" still looks like eno rather than a gray void. Mascot
          `media` nodes render verbatim as before (bespoke art needs no coin). */}
      {media ?? (Icon && (
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
