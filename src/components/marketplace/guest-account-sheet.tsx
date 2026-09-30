'use client'

import { useRef } from 'react'
import Link from 'next/link'
import { ChevronRight, CircleHelp, ShieldCheck } from '@/components/ui/icons'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/context/language-context'
import { preloadSignIn, useAuth } from '@/context/auth-context'
import { STROKE_UI } from '@/lib/icon-tokens'
import { CurrencySelect, LanguageSelect } from './footer-preferences'

/**
 * ── The phone's GUEST Account sheet (owner, O-09 "Guest chrome", 2026-09-30) ────────────────────
 *
 * A guest's Account tab used to open the sign-in card and nothing else — so on a phone a guest had no
 * way to change the language or the display currency short of scrolling to the footer (the only other
 * place those live for someone without an account), and no route to Help or Safety from the chrome.
 * The tab now opens this sheet: Sign in first (it is still the main thing the tab is for), then
 * Language, Currency, Help, Safety.
 *
 * ⚠️ NO DESKTOP GLOBE (owner, same row): desktop keeps the footer's switcher and the header's Sign in.
 * This sheet is reached only from the tab bar, which is `lg:hidden`.
 * ⚠️ THE PICKERS ARE THE FOOTER'S OWN (footer-preferences.tsx `LanguageSelect` / `CurrencySelect`), so
 * the two places cannot disagree about what an option is called or what choosing it does — including
 * the full reload a language change across the en/vi variant needs (language-context.tsx `setLang`).
 * ⚠️ `ui/drawer`, the canon's bottom sheet (Base UI Drawer): swipe-to-dismiss, the scrim, focus trap
 * and return. CustomSelect's menus sit at z-[1200], above the drawer's `z-overlay`, by design.
 *
 * ⛔ SIGN IN HANDS OVER TO THE ONE SIGN-IN CARD, IT DOES NOT REPLACE IT. The sheet closes and the
 * standard dialog opens (auth-context `openSignIn`, with this tab's context line). `finalFocus` is
 * switched off for that one close: otherwise the drawer, finishing its exit, would put focus back on
 * the Account tab — BEHIND the sign-in dialog that just took it.
 */
export function GuestAccountSheet({ open, onOpenChange, signInNote }: { open: boolean; onOpenChange: (open: boolean) => void; signInNote?: string }) {
  const { tr } = useLanguage()
  const { openSignIn } = useAuth()
  const handingOff = useRef(false)

  const signIn = () => {
    handingOff.current = true
    onOpenChange(false)
    openSignIn(signInNote ? { note: signInNote } : undefined)
  }

  // A row that goes somewhere: 48px, full width, trailing chevron. Closing on click keeps the sheet
  // from sitting over the page it just opened (a client navigation does not unmount the tab bar).
  const row = 'flex min-h-12 w-full items-center gap-3 rounded-xl px-2 text-sm font-semibold text-foreground hover:bg-muted press'

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (next) handingOff.current = false
        onOpenChange(next)
      }}
      showSwipeHandle
    >
      <DrawerContent finalFocus={() => !handingOff.current}>
        <DrawerHeader className="text-left">
          <DrawerTitle className="text-left text-base font-bold">{tr('Account', 'Tài khoản')}</DrawerTitle>
          <DrawerDescription className="text-left">
            {tr('Sign in to post, chat with sellers and get alerts.', 'Đăng nhập để đăng tin, nhắn tin với người bán và nhận thông báo.')}
          </DrawerDescription>
        </DrawerHeader>

        <div className="min-h-0 overflow-y-auto overscroll-contain px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom),var(--safe-area-inset-bottom,0px))]">
          <Button
            type="button"
            variant="cta"
            size="lg"
            className="min-h-12 w-full"
            onPointerDown={preloadSignIn}
            onClick={signIn}
          >
            {tr('Sign in', 'Đăng nhập')}
          </Button>

          {/* Language + currency — a labelled row each. The visible word is `aria-hidden` because the
              picker already carries the same name (CustomSelect's sr-only label), so a screen reader
              hears it once, and a voice user can say what they see (WCAG 2.5.3). */}
          <div role="group" aria-label={tr('Language and currency', 'Ngôn ngữ và tiền tệ')} className="mt-4 divide-y divide-border">
            <div className="flex min-h-12 items-center justify-between gap-3 px-2">
              <span aria-hidden="true" className="text-sm font-semibold text-foreground">{tr('Language', 'Ngôn ngữ')}</span>
              <LanguageSelect className="min-h-11 text-body hover:bg-muted" wrapperClassName="min-w-0 shrink" />
            </div>
            <div className="flex min-h-12 items-center justify-between gap-3 px-2">
              <span aria-hidden="true" className="text-sm font-semibold text-foreground">{tr('Currency', 'Tiền tệ')}</span>
              <CurrencySelect className="min-h-11 text-body hover:bg-muted" wrapperClassName="min-w-0 shrink" />
            </div>
          </div>

          <nav aria-label={tr('Help and safety', 'Trợ giúp và an toàn')} className="mt-2 border-t border-border pt-2">
            <ul>
              <li>
                <Link href="/help" prefetch={false} onClick={() => onOpenChange(false)} className={row}>
                  <CircleHelp className="h-5 w-5 shrink-0 text-ink-4" strokeWidth={STROKE_UI} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{tr('Help center', 'Trung tâm trợ giúp')}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-ink-4" aria-hidden />
                </Link>
              </li>
              <li>
                <Link href="/safety" prefetch={false} onClick={() => onOpenChange(false)} className={row}>
                  <ShieldCheck className="h-5 w-5 shrink-0 text-ink-4" strokeWidth={STROKE_UI} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{tr('Safe trading', 'An toàn giao dịch')}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-ink-4" aria-hidden />
                </Link>
              </li>
            </ul>
          </nav>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
