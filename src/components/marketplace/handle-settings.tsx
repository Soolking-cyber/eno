'use client'

import { useEffect, useState } from 'react'
import { useLanguage } from '@/context/language-context'
import { HandleEditor } from './handle-editor'

// Dashboard → Settings section for public @handles: the user's own handle and —
// when they run a storefront — the shop's handle ("Apple Store" → @apple_store).
// Self-hydrates from /api/me so the dashboard payload stays untouched.
export function HandleSettings() {
  const { tr } = useLanguage()
  const [me, setMe] = useState<{ handle: string | null; shopHandle: string | null; sellerId: string | null } | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/me')
      .then((r) => r.json())
      .then((d) => { if (alive && d.user) setMe({ handle: d.user.handle ?? null, shopHandle: d.user.shopHandle ?? null, sellerId: d.user.sellerId ?? null }) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  if (!me) return null
  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed text-body">
        {tr(
          'Your handle is your public link — share eno.vn/@you anywhere and people land on your page.',
          'Tên định danh là liên kết công khai của bạn — chia sẻ eno.vn/@ban ở bất cứ đâu.',
        )}
      </p>
      <HandleEditor target="profile" initial={me.handle} label={tr('Your handle', 'Tên của bạn')} />
      {me.sellerId && (
        <HandleEditor target="seller" initial={me.shopHandle} label={tr('Shop handle', 'Tên gian hàng')} />
      )}
    </div>
  )
}
