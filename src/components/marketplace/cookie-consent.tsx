'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useLanguage } from '@/context/language-context'
import { getConsent, setConsent, syncConsentCookie } from '@/lib/consent'
import { Mascot } from './mascot'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

function Toggle({ title, desc, value, onChange, locked = false }: { title: string; desc: string; value: boolean; onChange?: (v: boolean) => void; locked?: boolean }) {
  return (
    <button
      type="button"
      disabled={locked}
      onClick={() => onChange?.(!value)}
      className={cn('flex w-full items-start gap-2.5 rounded-lg p-1.5 text-left transition-colors', locked ? 'opacity-70' : 'hover:bg-muted cursor-pointer')}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold text-foreground">{title}</span>
        <span className="mt-0.5 block text-[11px] leading-snug text-ink-4">{desc}</span>
      </span>
      <span className={cn('mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors', value ? 'bg-primary' : 'bg-line-strong')}>
        <span className={cn('h-4 w-4 rounded-full bg-white shadow-sm transition-transform', value && 'translate-x-4')} />
      </span>
    </button>
  )
}

/** Sleek, compact consent banner — a horizontal card with the shield mascot filling
 *  the height on the left and tight copy + slim actions on the right. "Allow" turns on
 *  personalized recommendations + ad signals; "Settings" fine-tunes each or declines. */
export function CookieConsent() {
  const { tr } = useLanguage()
  const [show, setShow] = useState(false)
  const [view, setView] = useState<'ask' | 'settings'>('ask')
  const [perso, setPerso] = useState(true)
  const [ads, setAds] = useState(true)

  // Mirror any pre-cookie-era consent into the server-readable cookie, then
  // only prompt users who have never chosen.
  useEffect(() => { syncConsentCookie(); if (getConsent() === null) setShow(true) }, [])

  // Withdrawal right (PDPL): the footer "Cookie settings" link dispatches this to
  // reopen the banner any time, pre-filled with the current choice, so consent is
  // as easy to change as to give (compliance verification 2026-07-06).
  useEffect(() => {
    const reopen = () => {
      const c = getConsent()
      setPerso(c !== 'essential')
      setAds(c === 'all')
      setView('settings')
      setShow(true)
    }
    window.addEventListener('eno:open-consent', reopen)
    return () => window.removeEventListener('eno:open-consent', reopen)
  }, [])
  if (!show) return null

  const close = () => setShow(false)
  const allow = () => { setConsent('all'); close() }
  const save = () => { setConsent(ads ? 'all' : perso ? 'personalized' : 'essential'); close() }
  const decline = () => { setConsent('essential'); close() }

  const primary = 'rounded-lg px-4 py-1.5 text-sm transition-colors active:scale-95 cursor-pointer'
  const ghost = 'rounded-lg px-3 py-1.5 text-sm font-semibold text-body transition-colors hover:bg-muted active:scale-95 cursor-pointer'

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" aria-hidden onClick={close} />
      <div className="relative flex w-full max-w-md items-center gap-2 overflow-hidden rounded-2xl bg-card p-3 shadow-overlay animate-in fade-in zoom-in-95 duration-150 sm:gap-3.5 sm:p-4">
        {/* Mascot — fills the card height (the tallest element), minimal padding. */}
        <Mascot name="cookie" className="h-24 w-24 shrink-0 self-center text-foreground sm:h-28 sm:w-28" />

        <div className="min-w-0 flex-1 pr-0.5">
          {view === 'ask' ? (
            <>
              <h2 className="text-[15px] font-bold leading-tight text-foreground sm:text-base">{tr('Want results made for you?', 'Muốn kết quả dành riêng cho bạn?')}</h2>
              <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
                {tr(
                  'Allow cookies and we’ll put the most relevant products first — and keep you signed in. ',
                  'Cho phép cookie để chúng tôi đưa sản phẩm phù hợp nhất lên đầu — và giữ bạn đăng nhập. ',
                )}
                <Link href="/privacy" className="font-semibold text-accent-foreground underline underline-offset-2">{tr('Privacy policy', 'Chính sách quyền riêng tư')}</Link>
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2.5">
                <Button variant="cta" size="none" onClick={allow} className={primary}>{tr('Allow', 'Cho phép')}</Button>
                <button onClick={decline} className={ghost}>{tr('Decline', 'Từ chối')}</button>
                <button onClick={() => setView('settings')} className={ghost}>{tr('Settings', 'Tùy chỉnh')}</button>
              </div>
            </>
          ) : (
            <>
              <h2 className="text-[15px] font-bold leading-tight text-foreground sm:text-base">{tr('Your choices', 'Lựa chọn của bạn')}</h2>
              <div className="mt-1.5 -ml-1.5 space-y-0">
                <Toggle locked value title={tr('Essential', 'Cần thiết')} desc={tr('Sign-in & speed. Always on.', 'Đăng nhập & tốc độ. Luôn bật.')} />
                <Toggle value={perso} onChange={setPerso} title={tr('Personalized', 'Cá nhân hoá')} desc={tr('Rank the most relevant items first from your activity.', 'Xếp hạng mục phù hợp nhất theo hoạt động của bạn.')} />
                <Toggle value={ads} onChange={setAds} title={tr('Ad personalization', 'Quảng cáo cá nhân hoá')} desc={tr('Ad-network signals (Meta/Google) for retargeting.', 'Tín hiệu mạng quảng cáo (Meta/Google) để tiếp thị lại.')} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2.5">
                <Button variant="cta" size="none" onClick={save} className={primary}>{tr('Save', 'Lưu')}</Button>
                <button onClick={decline} className={ghost}>{tr('Decline all', 'Từ chối tất cả')}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
