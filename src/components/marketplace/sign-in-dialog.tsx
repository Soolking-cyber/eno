'use client'

import Image from 'next/image'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useLanguage } from '@/context/language-context'
import { SignInForm } from '@/components/marketplace/sign-in-form'

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

/** Inline sign-in modal (opened via auth-context's openSignIn for gated actions
 *  like revealing a phone or messaging a seller). Shares all logic with the
 *  dedicated /signin page via <SignInForm>. */
export function SignInDialog({ open, onOpenChange, listingTitle, listingImage, sellerName }: Props) {
  const { tr } = useLanguage()
  const seller = sellerName || tr('the seller', 'người bán')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl shadow-overlay w-full max-w-sm p-6 gap-0">
        <DialogHeader>
          {listingTitle ? (
            <div className="flex items-center gap-3 text-left">
              {listingImage && (
                <Image src={listingImage} alt="" width={48} height={48} className="h-12 w-12 shrink-0 rounded-lg object-cover" />
              )}
              <div className="min-w-0 space-y-0.5">
                <DialogTitle className="text-sm font-bold leading-snug text-foreground line-clamp-2">
                  {tr(`Sign in to message ${seller} about ${listingTitle}`, `Đăng nhập để nhắn ${seller} về ${listingTitle}`)}
                </DialogTitle>
                <p className="text-xs text-muted-foreground">
                  {tr('Free · takes 20 seconds · your number stays private', 'Miễn phí · 20 giây · số của bạn được giữ kín')}
                </p>
              </div>
            </div>
          ) : (
            <DialogTitle className="text-center text-lg font-bold text-foreground">
              {tr('Sign in to eno.vn', 'Đăng nhập eno.vn')}
            </DialogTitle>
          )}
        </DialogHeader>
        <SignInForm className="mt-4" />
      </DialogContent>
    </Dialog>
  )
}
