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
import { TosChangeNotice } from "@/components/marketplace/tos-change-notice";
import { AccountPanelShell } from "@/components/marketplace/account-panel";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NativeBootstrap } from "@/components/native/native-bootstrap";
import { NativePush } from "@/components/native/native-push";
import { NativeBadge } from "@/components/native/native-badge";
import { PwaBadge } from "@/components/native/pwa-badge";

// The app's provider pyramid + persistent chrome, extracted VERBATIM from
// src/app/layout.tsx (audit §E) so the layout keeps only document concerns
// (fonts, metadata, viewport, head). Server component composing client
// providers — module boundary has no RSC effect. Nesting ORDER is load-bearing
// (each inline comment explains its own constraint); don't reorder casually.
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PrelaunchNotice />
      {/* The Đ.38.3 announcement of a pending Terms change. Sits beside PrelaunchNotice because
          both are legal notices that must be seen without hunting for them, and above ThemeProvider
          for the same reason that one is: nothing here depends on theme or language (it renders
          both languages at once). It hides itself when the new version takes effect — see the
          component for why it must stay a CLIENT component. */}
      <TosChangeNotice />
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
                {/* App-icon badge. Must sit INSIDE both providers — it reads the notification
                    and chat unread counts — and inside AuthProvider so sign-out clears it.
                    Two mutually-exclusive halves: NativeBadge (Capacitor build, no-op on web) and
                    PwaBadge (installed Safari/desktop PWA via the Web Badging API, no-op in the
                    native shell and in a plain browser tab). */}
                <NativeBadge />
                <PwaBadge />
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
                    {/* GLOBAL status-bar backdrop. The app is EDGE-TO-EDGE in the native
                        WebView (capacitor.config ios.contentInset:'never') and in the
                        installed PWA, so the web side owns the top safe area. #app-header
                        pads itself by env(safe-area-inset-top) — but it AUTO-HIDES on
                        scroll-down, and that is exactly when scrolling content would show
                        through the Dynamic Island strip. Only /dashboard used to cover it
                        (its own copy, dashboard/layout.tsx); this covers EVERY route.
                        Deliberately AFTER {children} in the DOM so it paints over the
                        page's own z-30 sticky bars, and styled at z-30 in globals.css so it
                        stays under the header (z-40) and every overlay (z-50+). Height is
                        env(safe-area-inset-top) → 0 on desktop/browser web, i.e. a no-op
                        there. Presentational only: aria-hidden + pointer-events:none. */}
                    <div aria-hidden id="status-bar-backdrop" />
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
