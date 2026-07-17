import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Tr } from '@/context/language-context'
import { cn } from '@/lib/utils'

/** Shopee "shop on top": a compact storefront entry that sits directly ABOVE the product
 *  media, so a buyer who likes the item can jump to the seller's full shop in one tap
 *  (the "SHOP >" bar in Shopee's product header). It complements — never replaces — the
 *  fuller trust-metric SellerCard lower in the buy box: this one is just the quick jump.
 *
 *  Server component (no hooks) so it renders inside the SSR'd/ISR'd PDP with the media.
 *  Dual-mounted like the gallery — one instance above the mobile media, one above the
 *  desktop media — so it reads identically on web (desktop+mobile) and in the iOS/Android
 *  WebView. Borderless, tokens-only. The whole row is already a large (~48px) tap target, so
 *  it deliberately does NOT use `tap-44`: that helper's absolute ::before hit-area needs a
 *  positioned host, and on this un-`relative` full-width row it balloons to an ancestor and
 *  overlays neighbours (it swallowed the buy-box "Chat now" CTA — caught by guest e2e). */
export function PdpShopLink({ name, avatarColor, isBusiness, href, className }: {
  name: string
  avatarColor?: string | null
  isBusiness?: boolean
  href: string
  className?: string
}) {
  return (
    <Link
      href={href}
      className={cn(
        'group flex items-center gap-2.5 rounded-2xl bg-secondary/40 px-3 py-2 transition-colors hover:bg-secondary',
        className,
      )}
    >
      <Avatar name={name} color={avatarColor} size="sm" />
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-sm font-semibold text-foreground">{name}</span>
        {/* text-ink-4 (not muted-foreground): this 11px meta sits on bg-secondary/40, where
            muted-foreground (#737373) is only 4.23:1 — axe-failing. ink-4 (#616161) is the token
            reserved for small meta on tint (~5.6:1, AA). */}
        <span className="truncate text-2xs font-medium text-ink-4">
          {isBusiness ? <Tr text="Official shop" /> : <Tr text="Visit storefront" />}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-0.5 text-xs font-semibold text-accent-foreground">
        <Tr text="Shop" />
        <ChevronRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none" />
      </span>
    </Link>
  )
}
