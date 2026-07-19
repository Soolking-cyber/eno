import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/context/theme-context";
import { LanguageProvider } from "@/context/language-context";
import { CurrencyProvider } from "@/context/currency-context";
import { AuthProvider } from "@/context/auth-context";
import { ChatProvider } from "@/context/chat-context";
import { NotificationsProvider } from "@/context/notifications-context";
import { FavoritesProvider } from "@/context/favorites-context";
import { QueryProvider } from "@/components/marketplace/query-provider";
import { MobileNav } from "@/components/marketplace/mobile-nav";
import { BottomNavSpacer } from "@/components/marketplace/bottom-nav-spacer";
import { KeyboardViewportSync } from "@/components/marketplace/keyboard-viewport-sync";
import { BackToTop } from "@/components/marketplace/back-to-top";
import { SkipLink } from "@/components/marketplace/skip-link";
import { CookieConsent } from "@/components/marketplace/cookie-consent";
import { InstallHint } from "@/components/marketplace/install-hint";
import { SaveSignupSheet } from "@/components/marketplace/save-signup-sheet";
import { ImageShield } from "@/components/marketplace/image-shield";
import { PrelaunchNotice } from "@/components/marketplace/prelaunch-notice";
import { AccountPanelShell } from "@/components/marketplace/account-panel";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NativeBootstrap } from "@/components/native/native-bootstrap";
import { NativePush } from "@/components/native/native-push";

// The app's provider pyramid + persistent chrome, extracted VERBATIM from
// src/app/layout.tsx (audit §E) so the layout keeps only document concerns
// (fonts, metadata, viewport, head). Server component composing client
// providers — module boundary has no RSC effect. Nesting ORDER is load-bearing
// (each inline comment explains its own constraint); don't reorder casually.
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PrelaunchNotice />
      <ThemeProvider>
        <LanguageProvider>
          {/* Native-shell (Capacitor) bootstrap — a no-op on web; on iOS/Android it hides the
              splash, theme-matches the status bar, bridges the native keyboard, handles back,
              and (needs LanguageProvider) localizes the long-press action sheet. Still inside
              ThemeProvider, so status-bar theming is unchanged. */}
          <NativeBootstrap />
          <SkipLink />
          <CurrencyProvider>
          <AuthProvider>
            {/* Native push registration — no-op on web + until the plugin is wired (dormant). */}
            <NativePush />
            <NotificationsProvider>
              <ChatProvider>
                <FavoritesProvider>
                  <QueryProvider>
                    {/* One delay group for every ui/tooltip in the app: moving between adjacent
                        icon tooltips feels instant once the first opens. Context only, no DOM. */}
                    <TooltipProvider>
                    <AccountPanelShell>
                    {children}
                    {/* Inside the shell so it can READ the panel state (it portals to
                        <body>, so nesting costs it no positioning): the floating
                        controls are fixed, which means the shell's lg:mr-[440px] can't
                        move them — they'd sit on top of the open dashboard rail. They
                        shift themselves instead. */}
                    <BackToTop />
                    </AccountPanelShell>
                    {/* Reserve room for the fixed mobile bottom-nav. A WHITE
                        spacer (not body padding) so when the nav auto-hides at
                        the page bottom it blends with the footer instead of
                        exposing a grey band. Collapses when the keyboard is up
                        (the nav hides then) so it doesn't leave a gap under the
                        chat composer. */}
                    <BottomNavSpacer />
                    <KeyboardViewportSync />
                    <MobileNav />
                    <CookieConsent />
                    <InstallHint />
                    <SaveSignupSheet />
                    <ImageShield />
                    </TooltipProvider>
                  </QueryProvider>
                </FavoritesProvider>
              </ChatProvider>
            </NotificationsProvider>
          </AuthProvider>
          </CurrencyProvider>
        </LanguageProvider>
        {/* Inside ThemeProvider so toasts follow the in-app theme toggle. */}
        <SonnerToaster position="top-center" closeButton />
      </ThemeProvider>
    </>
  );
}
