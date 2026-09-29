'use client'

import { Tag, MessageCircle, Bell } from '@/components/ui/icons'
import { preloadSignIn, useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { POSTING_IS_FREE } from '@/lib/site-identity'

/**
 * In-grid signup capture (5a #7) — one ROW slotted into the guest feed after its first page.
 * Value-first copy, one tap to the sign-in dialog (Google/phone/email all live there). Renders
 * nothing for signed-in users (or while auth is still loading); the grid simply closes up.
 *
 * ⛔ A FULL-WIDTH ROW, NOT A CELL (E-ORPHAN, 2026-09-29). As one grid cell it made page one 13 cells,
 * so every breakpoint ended on an orphan row, and as a tinted `h-full` box with a bottom-pinned CTA it
 * stretched to the tallest card beside it — a dead band of fill on the one-canvas feed. It now spans
 * the grid (`col-span-full`) under a hairline (flat canon §3b: lines, not boxes), text left and the
 * CTA right from `sm`, stacked on a phone. Its bottom hairline is drawn only when rows follow it
 * (`not-last:`): as the grid's last child the feed footer's own `border-t` ("Browse everything",
 * "Load more", the end line) is the next line, and two parallel hairlines 24px apart read as noise.
 * The explorer places it after the FIRST_PAGE_SIZE-th listing, which keeps every listing row full.
 *
 * ⛔ ONE CTA, AND IT DOES NOT SAY "GOOGLE" (A-GOOGLE, 2026-09-29). It used to offer "Continue with
 * Google" AND "or email · free, 10 seconds" — two controls that both only opened the sign-in popup,
 * the extra-tap anti-pattern the owner removed from the save sheet and the sign-in dialog on
 * 2026-08-28. "Join free" says what the tap does. ⚠️ The card must NOT start Google OAuth itself: the
 * consent line ("18 or older … Terms") lives in the sign-in form, and a one-tap OAuth here would skip
 * it. `onPointerDown` warms the dialog's chunk so the tap opens it at once.
 * ⚠️ "Keep your saved items" is gone because it was false: saves are device-local for signed-in users
 * too (favorites-context.tsx). "Post listings for free" is shown only while POSTING_IS_FREE holds —
 * that flag is the one place the day a fee is announced gets decided (src/lib/site-identity.ts).
 */
export function CaptureCard() {
  const { user, loading, openSignIn } = useAuth()
  const { tr } = useLanguage()
  if (user || loading) return null
  return (
    <div className="col-span-full flex flex-col gap-3 border-t border-border py-4 not-last:border-b sm:flex-row sm:items-center sm:gap-6">
      <div className="min-w-0">
        <p className="text-base font-extrabold leading-snug text-foreground">{tr('Never miss a deal.', 'Đừng bỏ lỡ món hời.')}</p>
        <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-body">
          {POSTING_IS_FREE && (
            <li className="flex items-center gap-1.5"><Tag className="h-3.5 w-3.5 shrink-0 text-accent-foreground" aria-hidden /> {tr('Post listings for free', 'Đăng tin miễn phí')}</li>
          )}
          <li className="flex items-center gap-1.5"><MessageCircle className="h-3.5 w-3.5 shrink-0 text-accent-foreground" aria-hidden /> {tr('Chat with sellers instantly', 'Nhắn tin ngay với người bán')}</li>
          <li className="flex items-center gap-1.5"><Bell className="h-3.5 w-3.5 shrink-0 text-accent-foreground" aria-hidden /> {tr('Price-drop & search alerts', 'Báo giá giảm & tin mới')}</li>
        </ul>
      </div>
      {/* Full width and 44px on a phone (a thumb target on its own line); content width from `sm`,
          pushed to the row's right edge. `whitespace-nowrap`: "Join free" / "Tham gia miễn phí" is one
          line at every width — the old two-column cell wrapped its label inside a 147px pill. */}
      <Button
        type="button"
        variant="cta"
        size="none"
        onPointerDown={preloadSignIn}
        onClick={() => openSignIn()}
        className="min-h-11 w-full shrink-0 whitespace-nowrap px-5 py-2.5 text-center active:scale-[0.96] sm:ml-auto sm:w-auto cursor-pointer"
      >
        {tr('Join free', 'Tham gia miễn phí')}
      </Button>
    </div>
  )
}
