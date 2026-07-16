'use client'

import { Children, isValidElement, useState, type ReactElement, type ReactNode } from 'react'
import { Menu } from '@base-ui/react/menu'
import { ChevronDown } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

/** A "More +N" chip that reveals overflow items in a dropdown — opens on HOVER on
 *  desktop and on TAP on mobile. Built on Base UI Menu (via ui/dropdown-menu): the
 *  primitive supplies role="menu"/menuitem, roving focus, typeahead, Escape and
 *  focus-return, and portals the popup out of the rails' overflow-x-auto clipping.
 *  Children are the overflow rows (the caller renders + wires their onClick); each is
 *  rendered AS a menu item, and selecting one closes the menu. */
export function MoreOverflow({ count, children, label }: { count: number; children: ReactNode; label?: string }) {
  const { tr } = useLanguage()
  // Open is held in React so the chip's open-state styling (filled card + rotated
  // chevron) can read it; onOpenChange keeps it in sync whether opened by hover or tap.
  const [open, setOpen] = useState(false)

  if (count <= 0) return null

  return (
    // modal={false}: a lightweight hover menu, not a scroll-locking dialog.
    // highlightItemOnHover={false} keeps the pointer :hover state (owned by the child
    // buttons) distinct from the keyboard data-highlighted cursor styled on the items.
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false} highlightItemOnHover={false}>
      {/* Base UI supplies aria-haspopup/expanded/controls + hover/tap open on the chip. */}
      <DropdownMenuTrigger
        openOnHover
        delay={0}
        closeDelay={140}
        render={
          <Button
            variant="bare"
            size="none"
            type="button"
            className={cn(
              // active:scale-100 is load-bearing: this button is the popover anchor and
              // floating-ui reads its rect — a press transform would move it.
              // justify-start likewise: the chip is w-full and its label must stay left-aligned.
              'inline-flex w-full shrink-0 items-center justify-start gap-1 whitespace-nowrap rounded-lg px-2.5 py-1 text-sm font-semibold transition-colors duration-150 active:scale-100 cursor-pointer tap-44 relative',
              open ? 'bg-card text-accent-foreground shadow-sm' : 'text-body hover:bg-card/70 hover:text-accent-foreground',
            )}
          >
            {label || tr('More', 'Thêm')}
            <span className="text-2xs font-bold text-ink-4">+{count}</span>
            <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-180')} />
          </Button>
        }
      />
      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={6}
        // bg-brand-50 (not bg-popover): the same blue tint as the subcategory / model grid this
        // overflows from, so the "More" popup reads as a continuation of that grid — one fluid
        // surface — rather than a detached white menu. p-1.5 mirrors the grid's padding too.
        className="flex w-62 max-h-[60vh] flex-col gap-0.5 overflow-y-auto scroll-thin rounded-2xl bg-brand-50 p-1.5 shadow-pop ring-0"
      >
        {Children.map(children, (child) =>
          isValidElement(child) ? (
            // Render each caller-supplied row AS a menu item: role="menuitem", roving
            // focus + typeahead, closes on select. nativeButton because the child is a
            // real <button> (ui/button). Its className is untouched (the pointer :hover
            // styling stays the caller's); only the KEYBOARD cursor is painted here, and
            // data-highlighted:* carries its own modifier so it can't collide with the child.
            <Menu.Item
              nativeButton
              render={child as ReactElement}
              className="data-highlighted:bg-card/70 data-highlighted:text-accent-foreground"
            />
          ) : (
            child
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
