'use client'

import { useVirtualKeyboard } from '@/hooks/use-virtual-keyboard'

/**
 * Reserves the height of the fixed mobile bottom-nav so page content isn't hidden
 * behind it. When the on-screen keyboard opens, the nav hides itself (see MobileNav)
 * — so this spacer must collapse too, otherwise its leftover ~4rem sits as dead space
 * BELOW the chat composer (the "gap where the navbar was"): on the messages page the
 * shell is sized to the visible viewport, and this trailing spacer is the only extra
 * scroll height, so removing it lets the composer sit flush against the keyboard.
 */
export function BottomNavSpacer() {
  const { open } = useVirtualKeyboard()
  if (open) return null
  return <div aria-hidden className="lg:hidden h-[calc(4rem+env(safe-area-inset-bottom))] bg-card" />
}
