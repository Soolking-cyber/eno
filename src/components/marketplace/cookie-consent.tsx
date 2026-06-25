'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useLanguage } from '@/context/language-context'
import { getConsent, setConsent } from '@/lib/consent'
import { Mascot } from './mascot'
import { cn } from '@/lib/utils'

function Toggle({ title, desc, value, onChange, locked = false }: { title: string; desc: string; value: boolean; onChange?: (v: boolean) => void; locked?: boolean }) {
  return (
    <button
      type="button"
      disabled={locked}
      onClick={() => onChange?.(!value)}
      className={cn('flex w-full items-start gap-3 rounded-xl p-2.5 text-left transition-colors', locked ? 'opacity-70' : 'hover:bg-muted cursor-pointer')}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        <span className="mt-0.5 block text-xs leading-snug text-ink-4">{desc}</span>
      </span>
      <span className={cn('mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors', value ? 'bg-[#0a66c2]' : 'bg-line-strong')}>
        <span className={cn('h-4 w-4 rounded-full bg-white shadow-sm transition-transform', value && 'translate-x-4')} />
      </span>
    </button>
  )
}

/** Centered consent modal. The shield mascot offers a cookie 🍪. "Allow" turns on
 *  personalized recommendations + ad signals; "Settings" lets the user fine-tune each
 *  or decline. Functional (essential) caching is always on once a choice is made. */
export function CookieConsent() {
  const { tr } = useLanguage()
  const [show, setShow] = useState(false)
  const [view, setView] = useState<'ask' | 'settings'>('ask')
  const [perso, setPerso] = useState(true)
  const [ads, setAds] = useState(true)

  useEffect(() => { if (getConsent() === null) setShow(true) }, [])
  if (!show) return null

  const close = () => setShow(false)
  const allow = () => { setConsent('all'); close() }
  const save = () => { setConsent(ads ? 'all' : perso ? 'personalized' : 'essential'); close() }
  const decline = () => { setConsent('essential'); close() }

  const primary = 'rounded-xl bg-[#0a66c2] px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#004182] active:scale-95 cursor-pointer'
  const ghost = 'rounded-xl px-5 py-2.5 text-sm font-semibold text-body transition-colors hover:bg-muted active:scale-95 cursor-pointer'

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" aria-hidden onClick={close} />
      {/* Mobile: vertical, mascot top-centre. Desktop: a long horizontal card, mascot
          to the LEFT of the text. */}
      <div className="relative flex w-full max-w-sm flex-col items-center gap-4 rounded-3xl bg-card p-6 text-center shadow-overlay animate-in fade-in zoom-in-95 duration-150 sm:max-w-2xl sm:flex-row sm:items-center sm:gap-6 sm:p-7 sm:text-left">
        <Mascot name="cookie" className="h-28 w-28 shrink-0 text-foreground sm:h-36 sm:w-36" />

        <div className="min-w-0 flex-1">
          {view === 'ask' ? (
            <>
              <h2 className="text-lg font-bold text-foreground">{tr('Want results made for you?', 'Muốn kết quả dành riêng cho bạn?')}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-body">
                {tr(
                  'Allow cookies and we’ll put the most relevant products first — and keep you signed in.',
                  'Cho phép cookie để chúng tôi đưa sản phẩm phù hợp nhất lên đầu — và giữ bạn đăng nhập.',
                )}
              </p>
              <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                <button onClick={allow} className={primary}>{tr('Allow', 'Cho phép')}</button>
                <button onClick={() => setView('settings')} className={ghost}>{tr('Settings', 'Tùy chỉnh')}</button>
              </div>
              <p className="mt-3 text-[11px] text-ink-4">
                <Link href="/privacy" className="font-semibold text-accent-foreground underline underline-offset-2">{tr('Privacy policy', 'Chính sách quyền riêng tư')}</Link>
              </p>
            </>
          ) : (
            <>
              <h2 className="text-lg font-bold text-foreground">{tr('Your choices', 'Lựa chọn của bạn')}</h2>
              <div className="mt-3 space-y-1 text-left">
                <Toggle
                  locked value
                  title={tr('Essential', 'Cần thiết')}
                  desc={tr('Keeps you signed in and the app fast. Always on.', 'Giữ đăng nhập và tải nhanh. Luôn bật.')}
                />
                <Toggle
                  value={perso} onChange={setPerso}
                  title={tr('Personalized recommendations', 'Gợi ý cá nhân hoá')}
                  desc={tr('Use your activity on eno.vn to rank the most relevant items first.', 'Dùng hoạt động của bạn trên eno.vn để xếp hạng mục phù hợp nhất.')}
                />
                <Toggle
                  value={ads} onChange={setAds}
                  title={tr('Ad personalization', 'Quảng cáo cá nhân hoá')}
                  desc={tr('Allow ad-network signals (Meta/Google) for retargeting.', 'Cho phép tín hiệu mạng quảng cáo (Meta/Google) để tiếp thị lại.')}
                />
              </div>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <button onClick={save} className={primary}>{tr('Save choices', 'Lưu lựa chọn')}</button>
                <button onClick={decline} className={ghost}>{tr('Decline all', 'Từ chối tất cả')}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
