'use client'

import { useIsPhone } from '@/hooks/use-is-phone'
import { Drawer, DrawerContent, DrawerFooter, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/**
 * The classroom's one floating panel: a bottom drawer on a phone, a dialog from `sm` up (design-language §5 "Every phone
 * picker / menu … a bottom sheet"). Base UI underneath both — focus held, Escape and the scrim close it, swipe-down on the
 * phone. A form inside scrolls; the footer stays.
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
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-3 scroll-thin">{children}</div>
          {footer && <DrawerFooter className="flex-row gap-3 border-t border-border pt-3">{footer}</DrawerFooter>}
        </DrawerContent>
      </Drawer>
    )
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] gap-0 overflow-hidden p-0 sm:max-w-lg">
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
