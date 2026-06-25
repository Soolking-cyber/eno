'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useLanguage } from '@/context/language-context'
import { getConsent, setConsent } from '@/lib/consent'
import { Mascot } from './mascot'

/** One-time consent card. The mascot offers a cookie 🍪. "Allow" turns on
 *  personalized recommendations + ad-network signals; "Essential only" keeps just
 *  the functional caching (inbox/prefs) that makes repeat visits instant. Sits above
 *  the mobile nav. */
export function CookieConsent() {
  const { tr } = useLanguage()
  const [show, setShow] = useState(false)

  useEffect(() => {
    // Show only until a choice is made (legacy 'accepted' counts as decided).
    if (getConsent() === null) setShow(true)
  }, [])

  if (!show) return null

  const choose = (level: 'all' | 'essential') => { setConsent(level); setShow(false) }

  return (
    <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-[120] px-3 lg:bottom-4 lg:px-0">
      <div className="mx-auto flex max-w-2xl items-center gap-4 rounded-2xl bg-card p-4 shadow-overlay">
        <Mascot name="cookie" className="hidden h-20 w-20 shrink-0 self-center text-accent-foreground sm:block" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-foreground">{tr('Want recommendations made for you?', 'Muốn gợi ý dành riêng cho bạn?')}</p>
          <p className="mt-1 text-xs leading-relaxed text-body">
            {tr(
              'Allow cookies so we can suggest the most relevant products for you and keep you signed in.',
              'Cho phép cookie để chúng tôi gợi ý sản phẩm phù hợp nhất và giữ bạn đăng nhập.',
            )}{' '}
            <Link href="/privacy" className="font-semibold text-accent-foreground underline underline-offset-2">
              {tr('Privacy policy', 'Chính sách quyền riêng tư')}
            </Link>
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => choose('all')}
              className="rounded-xl bg-[#0a66c2] px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-[#004182] active:scale-95 cursor-pointer"
            >
              {tr('Allow', 'Cho phép')}
            </button>
            <button
              onClick={() => choose('essential')}
              className="rounded-xl px-4 py-2 text-sm font-semibold text-body transition-colors hover:bg-muted active:scale-95 cursor-pointer"
            >
              {tr('Essential only', 'Chỉ cần thiết')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
