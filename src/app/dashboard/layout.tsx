import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'

/** Shared chrome for every /dashboard/* SECTION page (owner 2026-07-15: sections render in
 *  main, not in the account panel). Provides the one Header, the `<main id="main">` landmark
 *  (the skip-link target, tabIndex -1) + content container, and the Footer — so each section
 *  client renders only its content. The right-side account NAV RAIL is global (root layout's
 *  AccountPanelShell) and sits beside this main via the --account-w squeeze on desktop. */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    // Styling-only Gemini touch (owner 2026-07-16): the SAME structure (Header + section + Footer
    // + the global nav rail) — just floated on the serene radial-blue `dashboard-canvas` instead of
    // a flat bg, so the dashboard *feels* calmer without changing the layout or navigation.
    <div className="dashboard-canvas flex min-h-screen flex-col">
      <Header />
      {/* Fluid, breathing content (owner 2026-07-16): the boxy max-w-5xl is gone — the section
          now flows to the app's canonical page width (max-w-7xl) beside the borderless right nav
          rail, so the dashboard feels open and unified with the rest of the app, not trapped. */}
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-3 py-6 sm:px-6 lg:px-8">
        {children}
      </main>
      <Footer />
    </div>
  )
}
