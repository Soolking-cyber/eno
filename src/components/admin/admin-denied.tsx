import { ShieldAlert } from 'lucide-react'

// The one access-denied state for every admin page (rendered inside admin/layout.tsx,
// which already provides the AdminHeader). Admin surfaces are EN-only by convention.
export function AdminDenied() {
  return (
    <main id="main" tabIndex={-1} className="flex flex-1 items-center justify-center px-3">
      <div className="max-w-sm rounded-2xl bg-card p-8 text-center shadow-pop">
        <ShieldAlert className="mx-auto h-10 w-10 text-ink-4" />
        <h1 className="mt-4 text-lg font-bold text-foreground">Restricted area</h1>
        <p className="mt-2 text-sm text-muted-foreground">Sign in with an authorized eno.vn admin account to access this tool.</p>
        <a href="/" className="mt-5 inline-block rounded-xl bg-primary px-6 py-2 text-sm font-bold text-white hover:bg-brand-dark transition-colors">Back to eno.vn</a>
      </div>
    </main>
  )
}
