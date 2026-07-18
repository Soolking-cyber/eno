'use client'

import { Toaster } from 'sonner'
import { ThemeProvider } from '@/context/theme-context'
import { LanguageProvider } from '@/context/language-context'
import { AuthProvider } from '@/context/auth-context'
import { EnoAccountShell } from '@/components/dashboard/eno-account-shell'
import { ForumNativeBridge } from '@/components/native/forum-native-bridge'

export function ForumProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <ForumNativeBridge />
        <AuthProvider>
          <EnoAccountShell>{children}</EnoAccountShell>
          <Toaster position="top-center" richColors closeButton />
        </AuthProvider>
      </LanguageProvider>
    </ThemeProvider>
  )
}
