'use client'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useLanguage } from '@/context/language-context'
import { SignInForm } from '@/components/marketplace/sign-in-form'

type Props = { open: boolean; onOpenChange: (open: boolean) => void }

/** Inline sign-in modal (opened via auth-context's openSignIn for gated actions
 *  like revealing a phone or messaging a seller). Shares all logic with the
 *  dedicated /signin page via <SignInForm>. */
export function SignInDialog({ open, onOpenChange }: Props) {
  const { tr } = useLanguage()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card rounded-2xl shadow-overlay w-full max-w-sm p-6 gap-0">
        <DialogHeader>
          <DialogTitle className="text-center text-lg font-bold text-foreground">
            {tr('Sign in to eno.vn', 'Đăng nhập eno.vn')}
          </DialogTitle>
        </DialogHeader>
        <SignInForm className="mt-4" />
      </DialogContent>
    </Dialog>
  )
}
