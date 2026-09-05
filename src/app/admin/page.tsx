import type { Metadata } from 'next'
import Link from 'next/link'
import { AdminDenied } from '@/components/admin/admin-denied'
import { AdminSectionShell } from '@/components/admin/section-shell'
import { db } from '@/lib/db'
import { getAdmin } from '@/lib/admin'
import { scopedListingWhere } from '@/lib/edition-scope'
import { Card } from '@/components/ui/card'
import { IS_SERVICES } from '@/lib/edition'
import { openStatuses } from '@/lib/trips/status'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Admin — eno.vn', robots: { index: false, follow: false } }

// CONSOLE v2 HOME: what needs a human right now, and where the console goes. Every tile is a link
// into the section that does the work, and the queues with something waiting sort first. Until
// 2026-09-05 the admin home WAS the reports inbox, which is why two identity cases sat unreviewed
// for two days: the queue that needed a person had no tile, no row and no count anywhere.
const DAY_MS = 86_400_000

export default async function AdminOverviewPage() {
  const admin = await getAdmin()
  if (!admin) return <AdminDenied />
  const since7d = new Date(Date.now() - 7 * DAY_MS)
  const [pendingIdentity, pendingBusiness, openReports, appeals, underEnforcement, awaitingListings, usersTotal, users7d, listings7d, openTrips] = await Promise.all([
    db.identityVerification.count({ where: { status: 'pending' } }),
    db.sellerVerification.count({ where: { status: 'pending' } }),
    db.report.count({ where: { status: 'open' } }),
    db.report.count({ where: { status: 'open', appealedAt: { not: null } } }),
    db.profile.count({ where: { enforcementState: { not: 'good_standing' } } }),
    // Unverified-but-active = waiting for the catalogue review. Scoped like every listing read.
    db.listing.count({ where: await scopedListingWhere({ verified: false, status: 'active' }) }),
    db.profile.count(),
    db.profile.count({ where: { createdAt: { gte: since7d } } }),
    db.listing.count({ where: await scopedListingWhere({ postedAt: { gte: since7d } }) }),
    // The machine decides what "open" is (openStatuses derives it from the transition map) — a
    // hard-coded list here is exactly the drift the trips queue forbids.
    IS_SERVICES ? db.tripAssistanceRequest.count({ where: { status: { in: openStatuses() } } }).catch(() => 0) : Promise.resolve(0),
  ])

  const queues = [
    { label: 'Identity checks waiting', count: pendingIdentity, href: '/admin/verification?tab=identity', hint: 'People who submitted a passport or CCCD' },
    { label: 'Business verifications waiting', count: pendingBusiness, href: '/admin/verification?tab=business', hint: 'Storefronts that uploaded registration papers' },
    { label: 'Open reports', count: openReports, href: '/admin/moderation?tab=reports', hint: appeals > 0 ? `${appeals} with an appeal` : 'Triage inbox' },
    { label: 'Accounts under enforcement', count: underEnforcement, href: '/admin/moderation?tab=enforcement', hint: 'Warned, throttled, held or suspended' },
    // verified:false = NOT publicly live yet (its page 404s, absent from feed and search) — the
    // catalogue console's Publish is what makes it live, so this IS the review queue.
    { label: 'Listings awaiting review', count: awaitingListings, href: '/admin/catalogue?tab=listings', hint: 'Not yet published — Publish makes them live' },
    ...(IS_SERVICES ? [{ label: 'Open trip requests', count: openTrips, href: '/admin/services?tab=trips', hint: 'Trip desk' }] : []),
  ].sort((a, b) => Number(b.count > 0) - Number(a.count > 0))

  return (
    <AdminSectionShell title="Overview" description={<>Signed in as {admin}. What needs a person, then the sections.</>}>
      <h2 className="text-sm font-bold uppercase tracking-wide text-ink-4">Needs attention</h2>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {queues.map((q) => (
          <li key={q.href}>
            <Link href={q.href} className="block">
              <Card className="px-4 py-3 transition-colors hover:bg-muted/40">
                <p className={`text-2xl font-bold ${q.count > 0 ? 'text-foreground' : 'text-ink-4'}`}>{q.count}</p>
                <p className="mt-0.5 text-sm font-semibold text-foreground">{q.label}</p>
                <p className="text-xs text-muted-foreground">{q.hint}</p>
              </Card>
            </Link>
          </li>
        ))}
      </ul>

      <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-ink-4">Last 7 days</h2>
      <ul className="mt-2 grid gap-2 sm:grid-cols-3">
        {[
          { label: 'New accounts', value: users7d, href: '/admin/users' },
          { label: 'New listings', value: listings7d, href: '/admin/catalogue?tab=listings' },
          { label: 'Accounts in total', value: usersTotal, href: '/admin/users' },
        ].map((s) => (
          <li key={s.label}>
            <Link href={s.href} className="block">
              <Card className="px-4 py-3 transition-colors hover:bg-muted/40">
                <p className="text-2xl font-bold text-foreground">{s.value}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{s.label}</p>
              </Card>
            </Link>
          </li>
        ))}
      </ul>

      <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-ink-4">Sections</h2>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {[
          { href: '/admin/users', label: 'Users', hint: 'Find any account: identity, storefront, reports, enforcement, erasure.' },
          { href: '/admin/verification', label: 'Verification', hint: 'Identity (the person) and business (the storefront) queues.' },
          { href: '/admin/moderation', label: 'Moderation', hint: 'Reports, disputes and the enforcement ladder.' },
          { href: '/admin/catalogue', label: 'Catalogue', hint: 'Listings and the brand taxonomy.' },
          ...(IS_SERVICES ? [{ href: '/admin/services', label: 'Desks', hint: 'The e-Visa desk and the trip desk.' }] : []),
          { href: '/admin/insights', label: 'Insights', hint: 'Publish funnel and feedback.' },
        ].map((s) => (
          <li key={s.href}>
            <Link href={s.href} className="block">
              <Card className="px-4 py-3 transition-colors hover:bg-muted/40">
                <p className="text-sm font-semibold text-foreground">{s.label}</p>
                <p className="text-xs text-muted-foreground">{s.hint}</p>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </AdminSectionShell>
  )
}
