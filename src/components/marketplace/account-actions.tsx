'use client'

import { LogOut, LogIn } from '@/components/ui/icons'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'

/** Signed-out state for gated pages — a button that opens the sign-in dialog.
 *  Canonical example of the shared <Button variant="cta"> (h-auto + px/py keep the
 *  exact original padding). New primary CTAs should adopt this instead of re-coding
 *  bg-primary/hover:bg-brand-dark by hand. */
export function SignInPrompt() {
  const { openSignIn } = useAuth()
  const { tr } = useLanguage()
  return (
    <Button variant="cta" onClick={() => openSignIn()} className="h-auto rounded-xl px-6 py-2.5 cursor-pointer">
      <LogIn className="h-4 w-4" /> {tr('Sign in', 'Đăng nhập')}
    </Button>
  )
}

export function SignOutButton() {
  const { signOut } = useAuth()
  const { tr } = useLanguage()
  return (
    <Button
      variant="bare"
      size="none"
      onClick={() => signOut()}
      className="gap-1.5 text-sm font-semibold text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
    >
      <LogOut className="h-4 w-4" /> {tr('Sign out', 'Đăng xuất')}
    </Button>
  )
}
