import { AdminDenied } from '@/components/admin/admin-denied'
import { getAdmin } from '@/lib/admin'
import { EnforcementClient } from '@/components/admin/enforcement-client'
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
    return <AdminDenied />
  }

  return (
    <div className="flex flex-1 flex-col bg-background">
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-3 py-8 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h1 className="h-title text-foreground">Enforcement</h1>
          <p className="mt-1 text-sm text-muted-foreground">Signed in as {admin}. The account ladder (warn → throttle → hold → suspend): pending appeals first, then buyers waiting on a seller reply, then every active action.</p>
        </div>
        <EnforcementClient />
      </main>
    </div>
  )
}
