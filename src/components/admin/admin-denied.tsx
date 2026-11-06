import { ShieldAlert } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'

// The one access-denied state for every admin page (rendered inside admin/layout.tsx,
// whose chrome is the standard site Header — the rail's role-gated Admin group owns section nav). Admin surfaces are EN-only by convention.
export function AdminDenied() {
  return (
    <main id="main" tabIndex={-1} className="flex min-h-[70dvh] flex-1 items-center justify-center px-3 py-8">
      <div className="max-w-sm rounded-2xl border border-border p-8 text-center">
        <ShieldAlert className="mx-auto h-10 w-10 text-ink-4" />
        <h1 className="mt-4 text-lg font-bold text-foreground">This area is for eno staff</h1>
        <p className="mt-2 text-sm text-muted-foreground">This account has no admin access. Sign in with an authorized admin account to use this tool.</p>
        <Button asChild variant="cta" size="none"><a href="/" className="mt-5 px-6 py-2">Go to the home page</a></Button>
      </div>
    </main>
  )
}
