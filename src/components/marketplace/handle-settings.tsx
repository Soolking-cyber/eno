'use client'

import { Skeleton } from '@/components/ui/skeleton'

import { useEffect, useState } from 'react'
import { useLanguage } from '@/context/language-context'
import { HandleEditor } from './handle-editor'

// Dashboard → Settings section for the account's ONE public handle. When the account
// runs a storefront, the single handle lives on the shop ("Apple Store" → apple_store);
// otherwise it's the personal handle. Self-hydrates from /api/me so the dashboard
// payload stays untouched.
export function HandleSettings() {
  const { tr } = useLanguage()
  const [me, setMe] = useState<{ handle: string | null; shopHandle: string | null; sellerId: string | null; accountType: string | null } | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/me')
      .then((r) => r.json())
      .then((d) => { if (alive && d.user) setMe({ handle: d.user.handle ?? null, shopHandle: d.user.shopHandle ?? null, sellerId: d.user.sellerId ?? null, accountType: d.user.accountType ?? null }) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  if (!me) return (
    <div role="status" className="space-y-5">
      <Skeleton className="h-4 w-3/4 rounded-lg" />
      <Skeleton className="h-11 w-full rounded-xl" />
    </div>
  )
  // The single handle lives on the SHOP only for a BUSINESS account; an individual
  // (even one with a lingering storefront row) manages a personal handle.
  const isBusiness = me.accountType === 'business' && !!me.sellerId
  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed text-body">
        {tr(
          'Your handle is your public link — share eno.vn/you anywhere and people land on your page.',
          'Tên định danh là liên kết công khai của bạn — chia sẻ eno.vn/ban ở bất cứ đâu.',
        )}
      </p>
      {/* One handle per account: the shop's for a business, else personal. */}
      {isBusiness ? (
        <HandleEditor target="seller" initial={me.shopHandle} label={tr('Shop handle', 'Tên gian hàng')} />
      ) : (
        <HandleEditor target="profile" initial={me.handle} label={tr('Your handle', 'Tên của bạn')} />
      )}
    </div>
  )
}
