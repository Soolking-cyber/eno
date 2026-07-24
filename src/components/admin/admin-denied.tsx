import { ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'

// The one access-denied state for every admin page (rendered inside admin/layout.tsx,
// whose chrome is the standard site Header — the rail's role-gated Admin group owns section nav). Admin surfaces are EN-only by convention.
export function AdminDenied() {
  return (
    <main id="main" tabIndex={-1} className="flex flex-1 items-center justify-center px-3">
      <div className="max-w-sm rounded-2xl bg-popover p-8 text-center shadow-pop">
        <ShieldAlert className="mx-auto h-10 w-10 text-ink-4" />
        <h1 className="mt-4 text-lg font-bold text-foreground">Restricted area</h1>
        <p className="mt-2 text-sm text-muted-foreground">Sign in with an authorized eno.vn admin account to access this tool.</p>
        <Button asChild variant="cta" size="none"><a href="/" className="mt-5 px-6 py-2">Back to eno.vn</a></Button>
      </div>
    </main>
  )
}
