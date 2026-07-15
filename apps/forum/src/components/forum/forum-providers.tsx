'use client'

import { Toaster } from 'sonner'
import { LanguageProvider } from '@/context/language-context'

export function ForumProviders({ children }: { children: React.ReactNode }) {
  return (
    <LanguageProvider>
      {children}
      <Toaster position="top-center" richColors closeButton />
    </LanguageProvider>
  )
}
