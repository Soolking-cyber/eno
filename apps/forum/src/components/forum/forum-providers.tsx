'use client'

import { Toaster } from 'sonner'
import { ThemeProvider } from '@/context/theme-context'
import { LanguageProvider } from '@/context/language-context'
import { AuthProvider } from '@/context/auth-context'
import { ForumNativeBridge } from '@/components/native/forum-native-bridge'

export function ForumProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <ForumNativeBridge />
        <AuthProvider>
          {children}
          <Toaster position="top-center" richColors closeButton />
        </AuthProvider>
      </LanguageProvider>
    </ThemeProvider>
  )
}
