'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'
import { ArrowRight } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'

/**
 * THE WAY IN FOR A PROVIDER (owner, 2026-10-14: "people can post any type of service … dog walking baby sitting plumbing
 * etc."). /c/services lists what people offer; this one line, under the page's lede, takes someone who has a service to
 * offer straight to the post form with Services already picked (`/post?category=services` — the wizard preselects a
 * postable category when there is no draft to resume). Same shape as the teaching cross-links beside it.
 */
export function OfferServiceLink({ href, className }: { href: string; className?: string }) {
  const { tr } = useLanguage()
  return (
    <p className={cn('mt-3 max-w-prose text-sm text-body', className)}>
      {tr('Offer a service — dog walking, babysitting, repairs, cleaning?', 'Bạn cung cấp dịch vụ — dắt chó, trông trẻ, sửa chữa, dọn dẹp?')}{' '}
      <Link href={href} data-cross-link="offer-service" className="inline-flex items-center gap-1 font-semibold text-accent-foreground hover:underline">
        {tr('Post your service', 'Đăng dịch vụ của bạn')} <ArrowRight className="h-4 w-4 shrink-0" />
      </Link>
    </p>
  )
}
