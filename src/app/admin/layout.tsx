import { AdminHeader } from '@/components/admin/admin-header'

// One header (logo + section nav) for every admin page — pages render ONLY their main
// content at the canonical container width (max-w-7xl px-3 sm:px-6 lg:px-8), matching
// the rest of the app. Auth is NOT checked here: each page/route still re-checks
// getAdmin() server-side (never trust a layout gate).
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <AdminHeader />
      {children}
    </div>
  )
}
