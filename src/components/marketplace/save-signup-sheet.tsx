'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { Button } from '@/components/ui/button'

/**
 * Contextual signup sheet (5a #10) — appears ONCE, on a guest's first "save" tap:
 * the moment the value of an account is self-evident. Auth is asked when it helps
 * the user, never on arrival. favorites-context dispatches `eno:first-save`; the
 * flag lives in localStorage so the sheet never nags twice.
 */
export function SaveSignupSheet() {
  const { user, openSignIn } = useAuth()
  const { tr } = useLanguage()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onFirstSave = () => {
      if (user) return
      try {
        if (localStorage.getItem('eno:save-sheet-done')) return
        localStorage.setItem('eno:save-sheet-done', '1')
      } catch { /* private mode — show it anyway, once per session */ }
      setOpen(true)
    }
    window.addEventListener('eno:first-save', onFirstSave)
    return () => window.removeEventListener('eno:first-save', onFirstSave)
  }, [user])

  if (!open) return null
  return (
    <DialogPrimitive.Root open={true} onOpenChange={(open) => { if (!open) setOpen(false) }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="overlay-scrim fixed inset-0 z-[130] data-open:animate-in data-open:fade-in data-closed:animate-out data-closed:fade-out" />
        <div className="fixed inset-0 z-[130] flex flex-col justify-end">
          <DialogPrimitive.Popup aria-label={tr('Keep your saved items', 'Giữ tin đã lưu')} className="relative mx-auto w-full max-w-md rounded-t-2xl bg-card px-6 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-3 shadow-overlay outline-none animate-in slide-in-from-bottom-4 duration-250 data-closed:animate-out data-closed:slide-out-to-bottom-4">
            <div aria-hidden className="mx-auto h-1 w-10 rounded-full bg-line-strong" />
        <h2 className="mt-4 text-lg font-extrabold tracking-tight text-foreground">{tr('Saved! Now keep it.', 'Đã lưu! Giữ nó nhé.')}</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {tr('Sign up free to keep your saved items, chat with sellers and get price-drop alerts.', 'Đăng ký miễn phí để giữ tin đã lưu, nhắn tin với người bán và nhận báo giá giảm.')}
        </p>
        <div className="mt-4 space-y-2">
          <Button
            variant="cta"
            size="none"
            type="button"
            onClick={() => { setOpen(false); openSignIn() }}
            className="w-full py-3 active:scale-[0.96] cursor-pointer"
          >
            {tr('Continue with Google', 'Tiếp tục với Google')}
          </Button>
          <Button
            variant="soft"
            size="none"
            type="button"
            onClick={() => { setOpen(false); openSignIn() }}
            className="w-full py-2.5 font-bold text-foreground cursor-pointer"
          >
            {tr('Continue with email or phone', 'Tiếp tục với email hoặc SĐT')}
          </Button>
          <Button
            variant="bare"
            size="none"
            type="button"
            onClick={() => setOpen(false)}
            className="w-full py-1 text-xs font-semibold text-ink-4 hover:text-foreground cursor-pointer"
          >
            {tr('Not now', 'Để sau')}
          </Button>
        </div>
        <p className="mt-2 text-center text-3xs text-ink-4">{tr('Free forever · no spam · 10 seconds', 'Miễn phí · không spam · 10 giây')}</p>
        </DialogPrimitive.Popup>
      </div>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>
  )
}
