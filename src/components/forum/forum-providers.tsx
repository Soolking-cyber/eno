'use client'

import { Toaster } from 'sonner'
import { LanguageProvider } from '@/context/language-context'
import { AuthProvider } from '@/context/auth-context'
import { EnoAccountShell } from '@/components/dashboard/eno-account-shell'

export function ForumProviders({ children }: { children: React.ReactNode }) {
  return (
    <LanguageProvider>
      <AuthProvider>
        <EnoAccountShell>{children}</EnoAccountShell>
        <Toaster position="top-center" richColors closeButton />
      </AuthProvider>
    </LanguageProvider>
  )
}
