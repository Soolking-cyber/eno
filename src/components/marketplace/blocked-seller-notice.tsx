'use client'

import Link from 'next/link'
import { Ban } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'

/**
 * What a listing page or a storefront shows IN PLACE of a shop its viewer blocked (App Store Guideline 1.2 — the
 * blocked content leaves at once; src/lib/hidden-sellers.ts). The page wraps its content in `data-sid="<sellerId>"`
 * and renders this beside it, `display:none` at rest; the hidden-shops stylesheet hides the one and shows the other —
 * before first paint on a reload, the instant the Block answers on a tap. No state of its own, so it never flashes.
 * Its callers render it only while `ugc-safety` is on (the stylesheet never exists otherwise, and the markup need not).
 * The way back is Settings › Privacy, where the block can be undone.
 */
export function BlockedSellerNotice({ sellerId, kind, className }: { sellerId: string; kind: 'listing' | 'shop'; className?: string }) {
  const { tr } = useLanguage()
  return (
    // role="main": the page's own <main> is display:none while this shows, so this stands in as the one main landmark
    // (opus, review); at rest it is display:none itself, so exactly one is ever exposed.
    <div data-sid-notice={sellerId} role="main" className={cn('hidden py-16', className)}>
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 text-center">
        <Ban className="h-8 w-8 text-ink-4" aria-hidden />
        <p className="text-lg font-bold text-foreground">
          {kind === 'listing' ? tr('You blocked this seller', 'Bạn đã chặn người bán này') : tr('You blocked this shop', 'Bạn đã chặn cửa hàng này')}
        </p>
        <p className="text-sm text-body">
          {tr(
            'Their listings are hidden from everything you browse, and our moderators have been told.',
            'Tin đăng của họ đã được ẩn khỏi mọi nơi bạn xem, và đội kiểm duyệt đã được thông báo.',
          )}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 pt-1 text-sm font-semibold">
          <Link href="/" className="text-accent-foreground hover:underline">{tr('Back to browsing', 'Quay lại trang chủ')}</Link>
          <Link href="/dashboard/settings?tab=privacy" className="text-accent-foreground hover:underline">{tr('Manage blocked users', 'Quản lý người đã chặn')}</Link>
        </div>
      </div>
    </div>
  )
}
