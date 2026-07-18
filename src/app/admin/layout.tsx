import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'

// Admin pages are right-panel sections beside the ONE global nav rail (root layout's
// AccountPanelShell — its role-gated Admin group owns section navigation), mirroring
// /dashboard/layout.tsx: the standard site Header + Footer, no second nav and no
// bespoke admin chrome. Unlike the dashboard layout this one does NOT wrap children
// in a <main>: every /admin/* page already renders its own
// `<main id="main" tabIndex={-1}>` landmark at the canonical container width
// (max-w-7xl px-3 sm:px-6 lg:px-8) — a layout-level main would nest landmarks and
// duplicate the skip-link id. Auth is NOT checked here: each page/route still
// re-checks getAdmin() server-side (never trust a layout gate).
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      {children}
      <Footer />
    </div>
  )
}
