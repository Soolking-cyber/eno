'use client'

import { fillTemplate } from '@/lib/i18n/placeholders'
import type { ElementType } from 'react'
import Image from 'next/image'
import { useLanguage } from '@/context/language-context'
import { SignInForm } from '@/components/marketplace/sign-in-form'
import { Bell, MessageCircle, Tag } from '@/components/ui/icons'
import { cn } from '@/lib/utils'
import type { PendingIntent } from '@/lib/pending-intent'
import type { SignInGate, SignInMethod } from '@/lib/signup-prompt'

/**
 * THE ONE SIGN-IN SURFACE — owner, 2026-08-28: "unify all login signup pages to this only 1 popup
 * dont use other than this anywhere across the app where it is", with a phone and a desktop
 * screenshot of this exact card.
 *
 * ⛔ THIS EXISTS SO THERE IS EXACTLY ONE ANSWER TO "WHAT DOES SIGNING IN LOOK LIKE". Before it, the
 * app had three: this card inside `SignInDialog`, a split-layout `/signin` page with its own navy
 * brand panel and trust bullets, and a bottom sheet on first-save whose two buttons did nothing but
 * open the dialog anyway — an interstitial between the visitor and the thing they had already asked
 * for. The logic was always shared via `<SignInForm>`; what drifted was everything around it, which
 * is the half a visitor actually sees.
 *
 * ⚠️ IT IS THE CONTENTS OF THE CARD, NOT THE CARD'S FRAME. The dialog supplies its own `Popup` (and
 * its close button, focus trap and escape handling); `/signin` supplies a plain centred panel,
 * because a route cannot be a dialog — there is nothing behind it to dismiss to. Keeping the frame
 * out of here is what lets the same composition serve both without one of them faking the other.
 */
export function SignInCard({
  className,
  titleAs: Title = 'p',
  listingTitle,
  listingImage,
  sellerName,
  note,
  join,
  gate,
  resume,
}: {
  className?: string
  /**
   * ⛔ THE HOST SUPPLIES THE TITLE ELEMENT, AND A11Y IS WHY. Base UI names a dialog from its
   * `Dialog.Title`, so the popup's heading cannot be a plain `<p>` rendered in here — it would leave
   * the dialog unnamed for a screen reader. The page has the opposite need: a real heading in the
   * document outline, with no dialog anywhere. Passing the ELEMENT keeps one string and one layout
   * while each host gets the semantics it actually needs; hard-coding either would break the other.
   */
  titleAs?: ElementType
  /** Listing context: when present the card says WHAT signing in unlocks instead of a generic
   *  prompt. Only the dialog passes these — a direct visit to /signin has no listing in hand. */
  listingTitle?: string
  listingImage?: string | null
  sellerName?: string
  /**
   * What signing in is for, when the gate is not a listing (the availability check: "free, and the
   * eno team replies in Messages"). A context line, never a title — the title stays the site's own.
   */
  note?: string
  /**
   * THE JOIN PRESENTATION — the "Join eno" prompt (signup-prompt.tsx) asking a guest who has been
   * browsing for a minute. Only the dialog passes it. See `SignInPrompt` in auth-context.tsx.
   */
  join?: { onMethod?: (method: SignInMethod) => void }
  /** Which gate opened it (UX3 J1) — the /signin page passes nothing and is the `page` gate. */
  gate?: SignInGate
  /** The action to finish after sign-in (UX3 J5) — see SignInForm's `resume`. */
  resume?: PendingIntent | null
}) {
  const { tr } = useLanguage()
  const seller = sellerName || tr('the seller', 'người bán')
  if (join) {
    return (
      <div className={cn('w-full', className)}>
        <Title className="block px-8 text-center text-lg font-bold text-foreground">
          {tr('Join eno — it’s free', 'Tham gia eno — miễn phí')}
        </Title>
        {/**
          * ⛔ EVERY LINE HERE IS SOMETHING ONLY AN ACCOUNT DOES — CHECKED IN THE CODE, NOT ASSUMED.
          * · Messaging a seller needs an account (the composer opens THIS popup for a guest), and a
          *   price drop is pushed to the buyers who messaged or revealed the contact on that listing
          *   (price-drop.ts notifyPriceDrop) — so "on what you ask about", never "on saved items".
          * · New-listing alerts are saved searches (SavedSearch + the saved-search-alerts cron).
          * · Posting needs an account and costs nothing (no commission, no paid bumps).
          * ⛔ NOT "save listings": saves are device-local for EVERYONE, guests included, and do not
          *   follow an account between devices (favorites-context.tsx) — save-signup-sheet.tsx records
          *   the same trap. Core-sprite glyphs only (scripts/critical-icons.mjs): this card must not be
          *   the thing that pulls the 188 KB deferred sprite onto every page a guest reads for a minute.
          */}
        <ul className="mx-auto mt-3 max-w-xs space-y-2 text-left text-sm leading-snug text-body">
          <li className="flex items-start gap-2.5">
            <MessageCircle className="mt-0.5 size-4 shrink-0 text-accent-foreground" aria-hidden />
            <span>{tr('Message sellers directly, and get price-drop alerts on what you ask about', 'Nhắn tin trực tiếp với người bán, và nhận thông báo giảm giá cho tin bạn đã hỏi')}</span>
          </li>
          <li className="flex items-start gap-2.5">
            <Bell className="mt-0.5 size-4 shrink-0 text-accent-foreground" aria-hidden />
            <span>{tr('Get alerts when new listings match a search you save', 'Nhận thông báo khi có tin mới khớp với tìm kiếm bạn đã lưu')}</span>
          </li>
          <li className="flex items-start gap-2.5">
            <Tag className="mt-0.5 size-4 shrink-0 text-accent-foreground" aria-hidden />
            <span>{tr('Post your own listings for free', 'Đăng tin bán miễn phí')}</span>
          </li>
        </ul>
        <SignInForm className="mt-4" collapseEmail onMethod={join.onMethod} gate="timed" />
      </div>
    )
  }
  return (
    <div className={cn('w-full', className)}>
      {listingTitle ? (
        // `pr-8`: the dialog's close button sits in the top-right corner, and at 360px a two-line title ran
        // under it (auth-05). The generic title below keeps the same clearance with `px-8`, like `join`.
        <div className="flex items-center gap-3 pr-8 text-left">
          {listingImage && (
            <Image src={listingImage} alt="" width={48} height={48} className="h-12 w-12 shrink-0 rounded-lg object-cover" />
          )}
          <div className="min-w-0 space-y-0.5">
            <Title className="text-sm font-bold leading-snug text-foreground line-clamp-2">
              {fillTemplate(tr('Sign in to message {seller} about {listingTitle}', 'Đăng nhập để nhắn {seller} về {listingTitle}'), 'Sign in to message {seller} about {listingTitle}', { seller: String(seller), listingTitle: String(listingTitle) })}
            </Title>
            <p className="text-xs text-muted-foreground">
              {note || tr('Free · takes 20 seconds · your number stays private', 'Miễn phí · 20 giây · số của bạn được giữ kín')}
            </p>
          </div>
        </div>
      ) : (
        <Title className="block px-8 text-center text-lg font-bold text-foreground">
          {/*
            ⛔ "LOG IN OR SIGN UP", NOT "SIGN IN TO eno.vn" (auth-04, 2026-10-04). A first-time visitor read
            "Sign in" as "for people who already have an account" and looked for a separate sign-up; this one
            form does both (Google or an email link makes the account on first use). The phrase is what
            Facebook, Airbnb and Chợ Tốt put on the same single popup. It names no site, so it is ONE literal
            on both editions — the edition ternary it replaced existed only because the old string named
            "eno.vn" (a template `Sign in to ${SITE_NAME}` would have skipped gen-ui-strings' literal harvest).
          */}
          {tr('Log in or sign up', 'Đăng nhập hoặc đăng ký')}
        </Title>
      )}
      {/* The generic header's context line, only when a caller supplied one. */}
      {!listingTitle && note ? (
        <p data-sign-in-note="" className="mt-1.5 text-center text-xs text-muted-foreground">{note}</p>
      ) : null}
      <SignInForm className="mt-4" gate={gate} resume={resume} />
    </div>
  )
}
