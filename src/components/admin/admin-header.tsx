import Link from 'next/link'

// Minimal top bar for admin pages. The section nav (Reports · Disputes · Enforcement ·
// Listings · Brands · Feedback) now lives in the LEFT nav rail (account-panel, which
// swaps to a dedicated admin nav on /admin/*), matching the seller dashboard — so this
// is just the brand + a back-to-site link. Flat: same bg as the canvas + a hairline line.
export function AdminHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-3 py-3 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2">
          <img src="/logo-mark.svg" alt="eno.vn" width={36} height={36} className="h-9 w-9" />
          <span className="text-sm font-bold text-foreground">Admin</span>
        </Link>
        <Link href="/" className="text-sm font-semibold text-accent-foreground hover:underline">Back to site</Link>
      </div>
    </header>
  )
}
