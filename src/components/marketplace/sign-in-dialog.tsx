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
  /** A context line for a gate that is not a listing (see SignInContext.note). */
  note?: string
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
export function SignInDialog({ open, onOpenChange, listingTitle, listingImage, sellerName, note }: Props) {
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
