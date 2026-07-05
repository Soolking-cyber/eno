import { getAdmin } from '@/lib/admin'
import { AdminHeader } from '@/components/admin/admin-header'
import { AdminNav } from '@/components/admin/admin-nav'
import { EnforcementClient } from '@/components/admin/enforcement-client'
import { ShieldAlert } from 'lucide-react'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Enforcement — eno.vn',
  robots: { index: false, follow: false },
}

// Enforcement ladder console (trust Phase 2). The shell is server-gated via
// getAdmin(); the data itself comes from GET /api/admin/enforcement, which
// re-checks getAdmin() on every call — the page gate is UX, not the security
// boundary.
export default async function AdminEnforcementPage() {
  const admin = await getAdmin()

  if (!admin) {
    return (
      <div className="flex min-h-screen flex-col">
        <AdminHeader />
        <main id="main" tabIndex={-1} className="flex flex-1 items-center justify-center px-3">
          <div className="max-w-sm rounded-2xl bg-card p-8 text-center shadow-pop">
            <ShieldAlert className="mx-auto h-10 w-10 text-ink-4" />
            <h1 className="mt-4 text-lg font-bold text-foreground">Restricted area</h1>
            <p className="mt-2 text-sm text-muted-foreground">Sign in with an authorized eno.vn admin account.</p>
            <a href="/" className="mt-5 inline-block rounded-xl bg-primary px-6 py-2 text-sm font-bold text-white hover:bg-brand-dark transition-colors">Back to eno.vn</a>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <AdminHeader />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-4xl flex-1 px-3 py-8 sm:px-6">
        <AdminNav active="/admin/enforcement" />
        <div className="mb-6">
          <h1 className="h-title text-foreground">Enforcement</h1>
          <p className="mt-1 text-sm text-muted-foreground">Signed in as {admin}. The account ladder (warn → throttle → hold → suspend): pending appeals first, then buyers waiting on a seller reply, then every active action.</p>
        </div>
        <EnforcementClient />
      </main>
    </div>
  )
}
