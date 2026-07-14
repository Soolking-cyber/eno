'use client'

import { Sparkles } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** The AI icon that sits left of the camera in every search bar. Pressing it opens the
 *  "eno AI" conversation in the messages tab (a native chat, not a popup). `active` is
 *  driven by the route so the icon fills in while you're on that chat. */
export function AISearchButton({
  active, onClick, className, iconClassName = 'h-6 w-6',
}: { active: boolean; onClick: () => void; className?: string; iconClassName?: string }) {
  const { tr } = useLanguage()
  return (
    <Button
      type="button"
      variant="bare"
      size="none"
      onClick={onClick}
      aria-pressed={active}
      aria-label={tr('AI shopping assistant', 'Trợ lý mua sắm AI')}
      title={tr('Ask eno AI', 'Hỏi eno AI')}
      className={cn(
        // Inactive = the search-bar icon standard (same as the magnifier + Map):
        // quiet ink, turns brand-blue on hover. Active keeps the filled state.
        // The caller's `iconClassName` (h-6 w-6 …) is a real class, (0,1,0), so it
        // outweighs the base icon rule `[:where(&)_svg]:size-4` at (0,0,1) — the
        // ✨ keeps its 24/28px size and is never squashed to 16px.
        'rounded-xl transition-[color,transform] duration-200 hover:scale-110 tap-44 relative',
        active ? 'bg-primary text-white shadow-sm' : 'text-ink-4 hover:text-accent-foreground',
        className,
      )}
    >
      <Sparkles className={iconClassName} />
    </Button>
  )
}
