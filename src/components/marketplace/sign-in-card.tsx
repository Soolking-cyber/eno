'use client'

import type { ElementType } from 'react'
import Image from 'next/image'
import { useLanguage } from '@/context/language-context'
import { IS_SERVICES } from '@/lib/edition'
import { SignInForm } from '@/components/marketplace/sign-in-form'
import { cn } from '@/lib/utils'

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
}) {
  const { tr } = useLanguage()
  const seller = sellerName || tr('the seller', 'người bán')
  return (
    <div className={cn('w-full', className)}>
      {listingTitle ? (
        <div className="flex items-center gap-3 text-left">
          {listingImage && (
            <Image src={listingImage} alt="" width={48} height={48} className="h-12 w-12 shrink-0 rounded-lg object-cover" />
          )}
          <div className="min-w-0 space-y-0.5">
            <Title className="text-sm font-bold leading-snug text-foreground line-clamp-2">
              {tr(`Sign in to message ${seller} about ${listingTitle}`, `Đăng nhập để nhắn ${seller} về ${listingTitle}`)}
            </Title>
            <p className="text-xs text-muted-foreground">
              {tr('Free · takes 20 seconds · your number stays private', 'Miễn phí · 20 giây · số của bạn được giữ kín')}
            </p>
          </div>
        </div>
      ) : (
        <Title className="block text-center text-lg font-bold text-foreground">
          {/*
            ⛔ TWO LITERAL tr() CALLS BEHIND THE EDITION TERNARY, NEVER `tr(\`Sign in to ${SITE_NAME}\`)`.
            This card is rendered by BOTH editions, and the string it replaced said "eno.vn"
            unconditionally — so every eno.forum visitor was invited to sign in to the other site.
            A reviewer caught it. The interpolated spelling would fix the branding and break the
            translation: `scripts/gen-ui-strings.mjs` harvests string LITERALS and silently skips a
            template expression, so it would ship untranslated to every other language. The ternary
            goes OUTSIDE tr(), which is also what footer.tsx spells out for the same reason.
          */}
          {IS_SERVICES ? tr('Sign in to eno.forum', 'Đăng nhập eno.forum') : tr('Sign in to eno.vn', 'Đăng nhập eno.vn')}
        </Title>
      )}
      <SignInForm className="mt-4" />
    </div>
  )
}
