'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'
import { useLanguage } from '@/context/language-context'

/**
 * THE WAY IN FOR A PROVIDER (owner, 2026-10-14: "people can post any type of service … dog walking baby sitting plumbing
 * etc."). /c/services lists what people offer; this one line, under the page's lede, takes someone who has a service to
 * offer straight to the post form with Services already picked (`/post?category=services` — the wizard preselects a
 * postable category when there is no draft to resume). Same shape as the teaching cross-links beside it (teaching-links.tsx:
 * the muted question, the inline underlined answer, no arrow — owner-approved 2026-11-14).
 */
export function OfferServiceLink({ href, className }: { href: string; className?: string }) {
  const { tr } = useLanguage()
  return (
    <p className={cn('mt-3 max-w-prose text-sm text-muted-foreground', className)}>
      {tr('Offer a service — dog walking, babysitting, repairs, cleaning?', 'Bạn cung cấp dịch vụ — dắt chó, trông trẻ, sửa chữa, dọn dẹp?')}{' '}
      <Link href={href} data-cross-link="offer-service" className="font-bold text-accent-foreground underline decoration-1 underline-offset-3">
        {tr('Post your service', 'Đăng dịch vụ của bạn')}
      </Link>
    </p>
  )
}
