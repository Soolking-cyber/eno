'use client'

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { SignInCard } from '@/components/marketplace/sign-in-card'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Optional listing context (thumbnail + title + seller): when present the dialog
   *  shows WHAT signing in unlocks instead of a generic prompt. Other call sites
   *  omit these and get the generic header unchanged. */
  listingTitle?: string
  listingImage?: string | null
  sellerName?: string
}

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
export function SignInDialog({ open, onOpenChange, listingTitle, listingImage, sellerName }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl shadow-overlay w-full max-w-sm sm:max-w-sm p-6 gap-0">
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
        />
      </DialogContent>
    </Dialog>
  )
}
