'use client'

import { Toaster } from 'sonner'
import { LanguageProvider } from '@/context/language-context'
import { AuthProvider } from '@/context/auth-context'

export function ForumProviders({ children }: { children: React.ReactNode }) {
  return (
    <LanguageProvider>
      <AuthProvider>
        {children}
        <Toaster position="top-center" richColors closeButton />
      </AuthProvider>
    </LanguageProvider>
  )
}
