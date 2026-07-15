import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'

/** Shared chrome for every /dashboard/* SECTION page (owner 2026-07-15: sections render in
 *  main, not in the account panel). Provides the one Header, the `<main id="main">` landmark
 *  (the skip-link target, tabIndex -1) + content container, and the Footer — so each section
 *  client renders only its content. The right-side account NAV RAIL is global (root layout's
 *  AccountPanelShell) and sits beside this main via the --account-w squeeze on desktop. */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 w-full max-w-5xl mx-auto px-3 py-6 sm:px-6 lg:px-8">
        {children}
      </main>
      <Footer />
    </div>
  )
}
