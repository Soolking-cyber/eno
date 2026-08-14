import type { Metadata } from 'next'
import { Map } from '@/components/ui/icons'
import { getAdmin } from '@/lib/admin'
import { AdminDenied } from '@/components/admin/admin-denied'
import { db } from '@/lib/db'
import { adminNextStatuses, isTerminalStatus } from '@/lib/trips/status'
import { TripsQueueClient, type QueueRow } from './trips-queue-client'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Trip assistance queue — eno.vn admin', robots: { index: false, follow: false } }

// The operator surface for trip assistance — a sibling of /admin/visas, which is the closest
// analogue: the same shape of queue and the same job of moving one case at a time.
//
// ⚠️ SAME ADMIN GATE AS THE VISA QUEUE. getAdmin() here, and getAdmin() again inside the API route
// (never trust a page gate for a write). A queue that authorised differently would be a second
// answer to "who is an operator".
//
// ⚠️ NOT A PAYMENTS SURFACE. The 10% fee is quoted in chat by quoteAssistance — the only writer of
// the money columns — and this page only READS the two amounts to show what was quoted.

export default async function AdminTripsPage() {
  const admin = await getAdmin()
  if (!admin) return <AdminDenied />

  // Ordered by last desk activity, which is what `updatedAt` means on this table: every transition
  // stamps it, and a card posted into the thread bumps it too. So the case somebody touched most
  // recently is the case an operator is most likely still working.
  const cases = await db.tripAssistanceRequest.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 200,
    select: {
      id: true, status: true, conversationId: true, assignedAdmin: true, updatedAt: true,
      supplierTotalVnd: true, feeVnd: true,
      itinerary: { select: { title: true } },
      profile: { select: { displayName: true, email: true } },
    },
  })

  const rows: QueueRow[] = cases.map((item) => ({
    id: item.id,
    status: item.status,
    // Derived HERE, on the server, because status.ts imports the Prisma client — see the note on
    // QueueRow.moves. The transition map is still the only thing that decides.
    // ⚠️ adminNextStatuses, NOT nextTripStatuses — the latter answers "what is legal from
    // here", which is not an authorisation answer. Rendering every legal edge is what let an
    // operator click "Quoted" and brick the money path; the server refuses these now too.
    moves: adminNextStatuses(item.status),
    itineraryTitle: item.itinerary?.title ?? 'Untitled trip',
    // Admin chrome shows who the case belongs to; name first, email as the fallback identity.
    travellerName: item.profile?.displayName || item.profile?.email || 'Unknown traveller',
    conversationId: item.conversationId,
    supplierTotalVnd: item.supplierTotalVnd,
    feeVnd: item.feeVnd,
    assignedAdmin: item.assignedAdmin,
    updatedAt: item.updatedAt.toISOString(),
  }))

  // Open above closed, each already newest-first. Grouping is presentation; "closed" is read from
  // the machine (isTerminalStatus derives it from the transition map) rather than from a list of
  // status names kept here, which would be one more thing to update when a status is added.
  const open = rows.filter((row) => !isTerminalStatus(row.status))
  const closed = rows.filter((row) => isTerminalStatus(row.status))

  return (
    <div className="flex flex-1 flex-col bg-background">
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-3 py-8 sm:px-6 lg:px-8">
        <div className="mb-5">
          <h1 className="h-title text-foreground">Trip assistance queue</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Signed in as {admin}. Move a case through the lifecycle; quote the fee in the traveller&apos;s thread, not here. eno arranges only — the traveller pays suppliers directly, so nothing on this page charges anyone.
          </p>
        </div>

        <section aria-labelledby="trips-open" className="space-y-3">
          <h2 id="trips-open" className="flex items-center gap-2 text-sm font-bold text-foreground">
            <Map className="h-4 w-4" aria-hidden="true" />
            Open ({open.length})
          </h2>
          <TripsQueueClient rows={open} />
        </section>

        {closed.length > 0 && (
          <section aria-labelledby="trips-closed" className="mt-8 space-y-3 border-t border-border pt-6">
            <h2 id="trips-closed" className="text-sm font-bold text-foreground">Closed ({closed.length})</h2>
            <TripsQueueClient rows={closed} />
          </section>
        )}
      </main>
    </div>
  )
}
