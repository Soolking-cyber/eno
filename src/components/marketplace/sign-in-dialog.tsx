'use client'

import { useEffect, useRef, useMemo } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { SignInCard } from '@/components/marketplace/sign-in-card'
import type { SignInPrompt } from '@/context/auth-context'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Optional listing context (thumbnail + title + seller): when present the dialog
   *  shows WHAT signing in unlocks instead of a generic prompt. Other call sites
   *  omit these and get the generic header unchanged. */
  listingTitle?: string
  listingImage?: string | null
  sellerName?: string
  /** A context line for a gate that is not a listing (see SignInContext.note). */
  note?: string
  /** The "Join eno" prompt's join presentation (see SignInContext.prompt). */
  prompt?: SignInPrompt
}

/**
 * THE JOIN PRESENTATION'S FRAME: a bottom sheet on a phone, the usual centred card from `sm` up — the
 * same ui/dialog override protections-row.tsx ships, with two differences that matter here:
 * · the sheet rides the keyboard (`bottom-[var(--kb-h,0px)]`, the app-wide contract var — see
 *   ui/dialog's KEYBOARD-AWARE note): "Use email instead" puts a focused field in this sheet, and on
 *   iOS the keyboard overlays the page, so a `bottom-0` sheet would put the field under it;
 * · from `sm` the top is the base's keyboard-aware centring, restated (`top-auto` replaced it), not a
 *   plain 50% — an iPad has a virtual keyboard too.
 * The bottom padding clears the home indicator, with the Android WebView variable fallback the cookie
 * bar uses. Enter and exit are the base's transitions with the transform swapped for a 1rem rise.
 */
/**
 * ⛔ THE JOIN PRESENTATION IGNORES PRESSES FOR ITS FIRST 400ms — the cookie bar's ARM_AFTER_MS, for the
 * cookie bar's reason. It appears ON ITS OWN, a minute in, under a thumb that is already scrolling or
 * aiming at a card: a tap committed before it existed would land on "Continue with Google" (and leave
 * the page for Google's account chooser) or on the backdrop (and count as a dismissal nobody chose).
 * Only presses: Esc is a deliberate key and still closes at once. A tap swallowed costs one more tap.
 */
const JOIN_ARM_MS = 400

const JOIN_FRAME = [
  'gap-0 rounded-2xl p-5 shadow-overlay sm:p-6',
  'top-auto bottom-[var(--kb-h,0px)] left-0 w-full max-w-full translate-x-0 translate-y-0 rounded-b-none max-h-[85dvh] overflow-y-auto overscroll-contain',
  'pb-[max(1.25rem,env(safe-area-inset-bottom),var(--safe-area-inset-bottom,0px))]',
  'starting:[transform:translateY(1rem)] data-starting-style:[transform:translateY(1rem)] data-ending-style:[transform:translateY(1rem)]',
  'not-supports-[transition-behavior:allow-discrete]:data-open:slide-in-from-bottom-4',
  'sm:top-[calc(50%+var(--vvt,0px)/2-var(--kb-h,0px)/2)] sm:bottom-auto sm:left-[50%] sm:max-w-sm sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-2xl sm:pb-6',
  'sm:starting:[transform:scale(0.95)] sm:data-starting-style:[transform:scale(0.95)] sm:data-ending-style:[transform:scale(0.95)]',
].join(' ')

/**
 * THE sign-in popup — the single auth surface in the app (owner, 2026-08-28). Everything that needs
 * a visitor signed in opens THIS, via auth-context's `openSignIn()`: a gated phone reveal, messaging
 * a seller, the first save, the end of the intro tour. `/signin` renders the same `<SignInCard>` as a
 * page, because a server `redirect()` cannot open a dialog.
 *
 * ⛔ DO NOT BUILD A SECOND ONE. There were three before this consolidation, and the one that did the
 * most damage was the politest: a first-save bottom sheet offering "Continue with Google" and
 * "Continue with email or phone", both of which only opened this dialog — a whole extra tap and a
 * second decision in front of a visitor who had already decided.
 */
export function SignInDialog({ open, onOpenChange, listingTitle, listingImage, sellerName, note, prompt }: Props) {
  // A new prompt object is a new ask (signup-prompt.tsx builds one per ask) — a fresh key per ask.
  const askKey = useMemo(() => (prompt ? `ask-${Math.random().toString(36).slice(2)}` : 'none'), [prompt])
  // Whether the join presentation acts on presses yet. Starts false and drops back on every close, so
  // there is no frame between the dialog painting and the timer starting in which a press would act.
  const armed = useRef(false)
  useEffect(() => {
    armed.current = false
    if (!open || !prompt) return
    const t = setTimeout(() => { armed.current = true }, JOIN_ARM_MS)
    return () => clearTimeout(t)
  }, [open, prompt])
  const arming = () => !armed.current
  if (prompt) {
    return (
      <Dialog
        open={open}
        onOpenChange={(o, details) => {
          if (!o && details.reason === 'outside-press' && arming()) { details.cancel(); return }
          onOpenChange(o)
        }}
      >
        <DialogContent
          className={JOIN_FRAME}
          // Capture phase, so the press never reaches the Google button, the fold, the × or a legal link.
          onClickCapture={(e) => { if (arming()) { e.preventDefault(); e.stopPropagation() } }}
        >
          {/* ⛔ THE ONLY WAY OUT IS THE × IN THE CORNER (owner, 2026-10-01: no "Maybe later" button) —
              ui/dialog's own close: top-right, a 44px hit area (`tap-44`), named "Close" / "Đóng". Esc
              and the backdrop do the same thing, and all three are the prompt's dismissal. It stays an
              honest soft ask: nothing here says browsing is blocked, and closing it costs nothing. */}
          {/* Keyed per ASK: the form's email-opened / email-reported state must not carry into the next prompt, or
              a second ask opens with email expanded and never reports its choice (codex, 2026-10-01). */}
          <SignInCard key={askKey} titleAs={DialogTitle} join={{ onMethod: prompt.onMethod }} />
        </DialogContent>
      </Dialog>
    )
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* ⚠️ THE PHONE GUTTER IS IN THE max-w, AND A PLAIN `max-w-sm` DELETED IT. ui/dialog's base carries
          `max-w-[calc(100%-2rem)]` as its small-screen guard; tailwind-merge drops it the moment a
          caller passes any other max-w, so this card rendered 384px wide on a 390px phone — 3px from
          each edge (measured on prod). min(24rem, 100% − 1.5rem) keeps the 384px card everywhere it
          fits and the canonical 12px phone gutter (px-3) below 408px. */}
      <DialogContent className="rounded-2xl shadow-overlay w-full max-w-[min(24rem,calc(100%-1.5rem))] sm:max-w-sm p-6 gap-0">
        {/*
          ⚠️ NO `DialogHeader` WRAPPER. It is a `flex flex-col gap-2` box meant for a title and a
          description, and `SignInCard` is title AND the whole form — so wrapping it put the email
          input, the OTP entry, the Google button and the legal line inside the dialog's HEADER
          region, both semantically and as flex children inheriting its gap. Two reviewers caught
          it. The card lays itself out; the dialog only needs to name itself, which `titleAs` does.
        */}
        <SignInCard
          titleAs={DialogTitle}
          listingTitle={listingTitle}
          listingImage={listingImage}
          sellerName={sellerName}
          note={note}
        />
      </DialogContent>
    </Dialog>
  )
}
