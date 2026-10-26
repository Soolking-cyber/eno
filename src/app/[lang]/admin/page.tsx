import type { Metadata } from 'next'
import Link from 'next/link'
import { AdminDenied } from '@/components/admin/admin-denied'
import { AdminSectionShell } from '@/components/admin/section-shell'
import { db } from '@/lib/db'
import { KYC_QUEUE_WHERE } from '@/lib/kyc/queue-where'
import { getAdmin } from '@/lib/admin'
import { scopedListingWhere } from '@/lib/edition-scope'
import { Card } from '@/components/ui/card'
import { IS_SERVICES } from '@/lib/edition'
import { openStatuses } from '@/lib/trips/status'
import { SUPPORT_SELLER_ID } from '@/lib/support-thread'
import { licenceGrandfatherUntilLabel, licenceQueueCounts } from '@/components/admin/licence-checks'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Admin — eno.vn', robots: { index: false, follow: false } }

// CONSOLE v2 HOME: what needs a human right now, and where the console goes. Every tile is a link
// into the section that does the work, and the queues with something waiting sort first. Until
// 2026-09-05 the admin home WAS the reports inbox, which is why two identity cases sat unreviewed
// for two days: the queue that needed a person had no tile, no row and no count anywhere.
const DAY_MS = 86_400_000

/** A tile wants a look when it counts something — or could not count at all ("—"). */
const needsLook = (count: number | string) => typeof count !== 'number' || count > 0

export default async function AdminOverviewPage() {
  const admin = await getAdmin()
  if (!admin) return <AdminDenied />
  const since7d = new Date(Date.now() - 7 * DAY_MS)
  const [pendingIdentity, pendingBusiness, openReports, appeals, underEnforcement, awaitingListings, usersTotal, users7d, listings7d, openTrips, supportUnread, licence] = await Promise.all([
    db.identityVerification.count({ where: KYC_QUEUE_WHERE }),
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
    /**
     * ⛔ THE QUEUE THAT HAD NO TILE, WHICH IS THE FAILURE THIS PAGE'S OWN HEADER DESCRIBES. Support
     * threads — including every WhatsApp message to the business number — were reachable by no URL
     * an operator could find, so six real customer messages sat unanswered while every pipeline
     * was green. `sellerUnread` is the desk's side of the count, so this is "waiting for us".
     */
    db.conversation.aggregate({ _sum: { sellerUnread: true }, where: { sellerId: SUPPORT_SELLER_ID } }).then((r) => r._sum.sellerUnread ?? 0).catch(() => 0),
    /**
     * ⛔ THE LICENCE CHECK (owner, 2026-10-14): e-Visa and Legal & permits listings from anyone but eno's desk wait for an
     * admin to compare the provider's licence — and nothing but Catalogue › Licence checks approves one, so a queue with
     * no tile is the failure this page's header describes. The non-desk aisle rows, classified exactly as the tab
     * classifies them (licence-checks.tsx): waiting = values to compare, values still missing, and VietKite's
     * grandfathered rows (live without a licence until LICENCE_GRANDFATHER.until).
     */
    // A failed count must not take the whole overview down with it (commit gate): the tile says it could not count.
    licenceQueueCounts().catch(() => null),
  ])

  const queues = [
    { label: 'Identity checks waiting', count: pendingIdentity, href: '/admin/verification?tab=identity', hint: 'People who submitted a passport or CCCD' },
    { label: 'Business verifications waiting', count: pendingBusiness, href: '/admin/verification?tab=business', hint: 'Storefronts that uploaded registration papers' },
    { label: 'Open reports', count: openReports, href: '/admin/moderation?tab=reports', hint: appeals > 0 ? `${appeals} with an appeal` : 'Triage inbox' },
    { label: 'Accounts under enforcement', count: underEnforcement, href: '/admin/moderation?tab=enforcement', hint: 'Warned, throttled, held or suspended' },
    // verified:false = NOT publicly live yet (its page 404s, absent from feed and search) — the
    // catalogue console's Publish is what makes it live, so this IS the review queue.
    { label: 'Listings awaiting review', count: awaitingListings, href: '/admin/catalogue?tab=listings&status=active&verified=false', hint: 'Not yet published — Publish makes them live (licence aisles: see Licence checks)' },
    // Publish skips the two licence aisles (it reports how many); they are approved under their own tab. The hint says
    // what is most urgent: a row live against the rule, then the grandfather's deadline, then the job itself.
    {
      label: 'Licence checks waiting',
      // A failed count is "—", never a quiet 0, and sorts with the tiles that need a look (commit gate).
      count: licence ? licence.waiting : '—',
      href: '/admin/catalogue?tab=licences',
      // An unresolved desk first (commit gate): its own e-Visa rows then count as anyone's — breaches included — and
      // Unpublish on them is refused anyway (the route answers desk_unresolved).
      hint: !licence
        ? 'e-Visa and Legal & permits — could not be counted: open the tab'
        : licence.deskUnresolved
          ? "e-Visa and Legal & permits — eno's desk did not resolve: its own listings are counted here too"
          : licence.breach > 0
            ? `e-Visa and Legal & permits — ${licence.breach} live without a checked licence`
            : licence.grandfathered > 0
              ? `e-Visa and Legal & permits — ${licence.grandfathered} live without a licence until ${licenceGrandfatherUntilLabel()}`
              : 'e-Visa and Legal & permits — match the emailed licence, then Approve',
    },
    ...(IS_SERVICES ? [{ label: 'Open trip requests', count: openTrips, href: '/admin/services?tab=trips', hint: 'Trip desk' }] : []),
    { label: 'Support messages waiting', count: supportUnread, href: '/admin/support', hint: 'In-app and WhatsApp — a reply goes back to WhatsApp' },
  ].sort((a, b) => Number(needsLook(b.count)) - Number(needsLook(a.count)))

  return (
    <AdminSectionShell title="Overview" description={<>Signed in as {admin}. What needs a person, then the sections.</>}>
      <h2 className="text-sm font-bold uppercase tracking-wide text-ink-4">Needs attention</h2>
      <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {queues.map((q) => (
          <li key={q.href}>
            <Link href={q.href} className="block">
              <Card className="px-4 py-3 transition-colors hover:bg-muted/40">
                <p className={`text-2xl font-bold ${needsLook(q.count) ? 'text-foreground' : 'text-ink-4'}`}>{q.count}</p>
                <p className="mt-0.5 text-sm font-semibold text-foreground">{q.label}</p>
                <p className="text-xs text-muted-foreground">{q.hint}</p>
              </Card>
            </Link>
          </li>
        ))}
      </ul>

      <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-ink-4">Last 7 days</h2>
      <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
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
      <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {[
          { href: '/admin/users', label: 'Users', hint: 'Find any account: identity, storefront, reports, enforcement, erasure.' },
          { href: '/admin/verification', label: 'Verification', hint: 'Identity (the person) and business (the storefront) queues.' },
          { href: '/admin/moderation', label: 'Moderation', hint: 'Reports, disputes and the enforcement ladder.' },
          { href: '/admin/catalogue', label: 'Catalogue', hint: 'Listings, licence checks and the brand taxonomy.' },
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
