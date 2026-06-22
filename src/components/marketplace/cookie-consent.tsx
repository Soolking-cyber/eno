'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Cookie } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { CONSENT_KEY, setConsent } from '@/lib/consent'

/** One-time consent bar. Accepting lets us cache your own data (inbox, prefs) to
 *  localStorage so the app loads instantly next time. Sits above the mobile nav. */
export function CookieConsent() {
  const { tr } = useLanguage()
  const [show, setShow] = useState(false)

  useEffect(() => {
    try {
      if (localStorage.getItem(CONSENT_KEY) !== 'accepted') setShow(true)
    } catch {
      /* storage blocked — don't nag */
    }
  }, [])

  if (!show) return null

  const accept = () => { setConsent(); setShow(false) }

  return (
    <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-[120] px-3 lg:bottom-4 lg:px-0">
      <div className="mx-auto flex max-w-2xl flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-overlay sm:flex-row sm:items-center">
        <Cookie className="hidden h-6 w-6 shrink-0 text-accent-foreground sm:block" />
        <p className="flex-1 text-xs leading-relaxed text-body">
          {tr(
            'We use cookies to keep you signed in and load faster.',
            'Chúng tôi dùng cookie để giữ đăng nhập và tải nhanh hơn.',
          )}{' '}
          <Link href="/privacy" className="font-semibold text-accent-foreground underline underline-offset-2">
            {tr('Read our privacy policy', 'Xem chính sách quyền riêng tư')}
          </Link>
        </p>
        <button
          onClick={accept}
          className="shrink-0 rounded-xl bg-[#0a66c2] px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-[#004182] active:scale-95 cursor-pointer"
        >
          {tr('Accept', 'Đồng ý')}
        </button>
      </div>
    </div>
  )
}
