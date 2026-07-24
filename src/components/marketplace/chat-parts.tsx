import { Send } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { Button } from '@/components/ui/button'
import { contactLinksFor, extractPhoneNumber } from '@/lib/phone'
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
 *  max-width via className (text thread 78%, AI thread 85%).
 *
 *  `allow-select`: message text is CONTENT, not chrome. html.native kills selection + the
 *  long-press callout app-wide so buttons and labels behave natively, which over-applied
 *  here — every native chat app lets you long-press a message to copy it (an address, a
 *  price, a Zalo handle). This opts the bubble back in, exactly like the listing
 *  description and the offer card in the text thread already do. */
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
        'allow-select rounded-2xl px-3.5 py-2 text-sm leading-relaxed',
        // Received bubble: a subtle `tint` well. `bg-card` collapsed into the canvas in the flat
        // design pass (docs/design-language.md §3b), which left received messages with NO fill —
        // bare text on the page. `tint` restores the light-grey received-bubble well (the shape
        // every chat app uses), distinct from the blue sent bubble; alignment carries the rest.
        failed ? 'border border-destructive/30 bg-destructive/10 text-destructive' : mine ? 'bg-primary text-white' : 'bg-tint text-foreground',
        pending && 'opacity-70',
        className,
      )}
    >
      {children}
      {typeof children === 'string' ? <ContactChips text={children} mine={mine} /> : null}
    </div>
  )
}

/**
 * ZALO **AND** WHATSAPP, off the same number.
 *
 * A Vietnamese seller lives on Zalo; a foreign buyer almost certainly has only WhatsApp —
 * and one Vietnamese mobile is reachable on both (owner, 2026-07-22: "since foreigners dont
 * have zalo ad whatsapp with same number so users can request whatspp or zalo both same
 * number"). Offering only Zalo asked half the marketplace to install an app they will never
 * use again; offering both costs nothing, because the number is identical.
 *
 * ⚠️ RENDERED ONLY FOR A STRING CHILD. MessageBubble also wraps rich nodes (offer cards,
 * visa cards); scanning those for a phone number would mean reaching into arbitrary JSX and
 * would risk turning a PRICE inside a card into a "message on WhatsApp" button.
 *
 * The number comes from extractPhoneNumber, which shares its regexes with the same
 * containsPhoneNumber gate that keeps numbers OFF public listings — so the two can never
 * disagree about what a phone number is. A VND price (3.160.000 đ) yields nothing, and a
 * spelled-out run is deliberately not reconstructed: a wrong number is worse than no button.
 */
function ContactChips({ text, mine }: { text: string; mine?: boolean }) {
  const phone = extractPhoneNumber(text)
  if (!phone) return null
  const links = contactLinksFor(phone)
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {[
        { href: links.zalo, label: 'Zalo' },
        { href: links.whatsapp, label: 'WhatsApp' },
      ].map((l) => (
        <Button
          key={l.label}
          asChild
          variant="bare"
          size="none"
          className={cn(
            'rounded-full border px-2.5 py-1 text-xs font-bold transition-colors',
            mine
              ? 'border-white/35 text-white hover:bg-white/15'
              : 'border-border text-body hover:bg-muted hover:text-accent-foreground',
          )}
        >
          {/* Leaves the app, and the destination is user-supplied content — noopener/
              noreferrer, and never target-blank without them. */}
          <a href={l.href} target="_blank" rel="noopener noreferrer nofollow">{l.label}</a>
        </Button>
      ))}
    </div>
  )
}
