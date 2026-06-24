import Link from 'next/link'

// Minimal header for admin pages — just the logo + a way back to the site. No
// consumer search bar / area picker / nav (those don't belong in admin tools).
export function AdminHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-3 py-3 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.svg" alt="eno.vn" width={36} height={36} className="h-9 w-9" />
          <span className="text-sm font-bold text-foreground">Admin</span>
        </Link>
        <Link href="/" className="text-sm font-semibold text-accent-foreground hover:underline">Back to site</Link>
      </div>
    </header>
  )
}
