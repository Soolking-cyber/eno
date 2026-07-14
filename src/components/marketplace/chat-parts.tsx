import { Send } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { cn } from '@/lib/utils'

// Shared chat primitives used by both threads (messages/[id] person-to-person + messages/ai).
// Pure presentational — no 'use client' needed.

/** The blue paper-plane send FAB (identical across the AI + text + offer composers). Bakes in
 *  the onMouseDown preventDefault "hold composer focus" trick so a tap never blurs the field →
 *  dismisses the keyboard → shifts the button out from under the finger before the click lands
 *  (Return still sends via enterKeyHint). Spread the rest (onClick/disabled/aria-label/title). */
export function ChatSendButton({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <IconButton
      size="lg"
      onMouseDown={(e) => e.preventDefault()}
      {...props}
      className={cn('bg-primary text-white transition-transform active:scale-90 disabled:opacity-40', className)}
    >
      <Send className="h-4 w-4" />
    </IconButton>
  )
}

/** A chat text bubble. `mine` = right-aligned brand bubble; `failed`/`pending` are the
 *  person-to-person optimistic-send states (the AI thread never sets them). Caller sets the
 *  max-width via className (text thread 78%, AI thread 85%). */
export function MessageBubble({
  mine,
  failed,
  pending,
  className,
  children,
}: {
  mine?: boolean
  failed?: boolean
  pending?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'rounded-2xl px-3.5 py-2 text-sm leading-relaxed',
        failed ? 'border border-destructive/30 bg-destructive/10 text-destructive' : mine ? 'bg-primary text-white' : 'bg-card text-foreground',
        pending && 'opacity-70',
        className,
      )}
    >
      {children}
    </div>
  )
}
