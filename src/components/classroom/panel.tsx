'use client'

import { useIsPhone } from '@/hooks/use-is-phone'
import { Drawer, DrawerContent, DrawerFooter, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

/**
 * A panel footer's button, sized for a thumb: 48px — the sticky action bar's height, so the classroom's bottom-edge
 * actions all match — and a long Vietnamese label wraps rather than pushing its neighbour out (min-w-0, whitespace-normal).
 * Use with `size="lg"`; `flex-1` shares the row.
 */
export const PANEL_BUTTON = 'min-h-12 min-w-0 flex-1 whitespace-normal'

/**
 * The classroom's one floating panel: a bottom drawer on a phone, a dialog from `sm` up (design-language §5 "Every phone
 * picker / menu … a bottom sheet"). Base UI underneath both — focus held, Escape and the scrim close it, swipe-down on the
 * phone. A form inside scrolls; the footer stays, its buttons within the thumb's reach.
 * Mobile first: a drawer with no footer keeps its last row off the home indicator (the footer does that itself when there
 * is one), and the dialog is the classroom's phone-width column (column.ts), not a wider desktop box.
 * The footer's buttons are the caller's — `PANEL_BUTTON` sizes them for a thumb.
 */
export function Panel({
  open, onOpenChange, title, description, footer, children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  footer?: React.ReactNode
  children: React.ReactNode
}) {
  const phone = useIsPhone()
  if (phone) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent>
          <DrawerHeader className="pb-1 text-left">
            <DrawerTitle className="text-base font-bold">{title}</DrawerTitle>
            {description && <DrawerDescription>{description}</DrawerDescription>}
          </DrawerHeader>
          {/* No footer: the body is the drawer's bottom edge, so it clears the home indicator the way DrawerFooter does
              (and drops back to 16px while the keyboard lifts the drawer — the footer's own swap). */}
          <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3 scroll-thin', footer ? 'pb-4' : 'pb-[max(1rem,env(safe-area-inset-bottom))] group-data-kb-open/drawer-popup:pb-4')}>{children}</div>
          {footer && <DrawerFooter className="flex-row gap-3 border-t border-border pt-3">{footer}</DrawerFooter>}
        </DrawerContent>
      </Drawer>
    )
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* ⚠️ `flex flex-col`, not the dialog's own grid: in a grid the body's `min-h-0 flex-1` does nothing, so a form taller
          than 85dvh (the seat sheet on a 800px laptop screen) grew past the cap and the footer — "Create invite" — was cut
          off under `overflow-hidden` instead of the body scrolling (measured at 1280×800, 2026-10-26). */}
      <DialogContent className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="px-6 pb-2 pt-6">
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4 scroll-thin">{children}</div>
        {footer && <DialogFooter className="border-t border-border px-6 py-4">{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  )
}
