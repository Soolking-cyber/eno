'use client'

import { Sparkles } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'

/** The AI icon that sits left of the camera in every search bar. Pressing it opens the
 *  "eno AI" conversation in the messages tab (a native chat, not a popup). `active` is
 *  driven by the route so the icon fills in while you're on that chat. */
export function AISearchButton({
  active, onClick, className, iconClassName = 'h-6 w-6',
}: { active: boolean; onClick: () => void; className?: string; iconClassName?: string }) {
  const { tr } = useLanguage()
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={tr('AI shopping assistant', 'Trợ lý mua sắm AI')}
      title={tr('Ask eno AI', 'Hỏi eno AI')}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-xl transition-all active:scale-95 tap-44 relative',
        active ? 'bg-primary text-white shadow-sm' : 'text-body hover:bg-muted',
        className,
      )}
    >
      <Sparkles className={iconClassName} />
    </button>
  )
}
