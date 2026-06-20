'use client'

import { LogOut, LogIn } from 'lucide-react'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'

/** Signed-out state for gated pages — a button that opens the sign-in dialog. */
export function SignInPrompt() {
  const { openSignIn } = useAuth()
  const { tr } = useLanguage()
  return (
    <button
      onClick={() => openSignIn()}
      className="inline-flex items-center gap-2 rounded-full bg-[#0a66c2] px-6 py-2.5 text-sm font-bold text-white hover:bg-[#004182] transition-colors cursor-pointer"
    >
      <LogIn className="h-4 w-4" /> {tr('Sign in', 'Đăng nhập')}
    </button>
  )
}

export function SignOutButton() {
  const { signOut } = useAuth()
  const { tr } = useLanguage()
  return (
    <button
      onClick={() => signOut()}
      className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#64748b] hover:text-red-600 transition-colors cursor-pointer"
    >
      <LogOut className="h-4 w-4" /> {tr('Sign out', 'Đăng xuất')}
    </button>
  )
}
