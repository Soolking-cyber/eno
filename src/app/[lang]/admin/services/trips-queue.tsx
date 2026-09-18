import { Map } from '@/components/ui/icons'
import type { TripDeskScope } from '@/lib/desk-operator'
import { db } from '@/lib/db'
import { adminNextStatuses, isTerminalStatus } from '@/lib/trips/status'
import { TripsQueueClient, type QueueRow } from '../trips/trips-queue-client'

// The operator surface for trip assistance — the Trips tab of /admin/services (services edition only,
// imported by page.svc.tsx alone). ⚠️ NOT A PAYMENTS SURFACE: the fee is quoted in chat by
// quoteAssistance; this only READS the two amounts to show what was quoted.
export async function TripsQueue({ scope }: { scope: TripDeskScope }) {
  const deskConversationIds = scope.all ? null : (await db.conversation.findMany({
    where: { sellerProfileId: scope.deskProfileId },
    select: { id: true },
  })).map((c) => c.id)

  // An empty id list means this desk answers no threads yet; `in: []` matches nothing — an empty
  // queue rather than an unfiltered one.
  const cases = await db.tripAssistanceRequest.findMany({
    where: deskConversationIds ? { conversationId: { in: deskConversationIds } } : undefined,
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
    // ⚠️ adminNextStatuses, NOT nextTripStatuses — an authorisation answer, not "what is legal".
    moves: adminNextStatuses(item.status),
    itineraryTitle: item.itinerary?.title ?? 'Untitled trip',
    travellerName: item.profile?.displayName || item.profile?.email || 'Unknown traveller',
    conversationId: item.conversationId,
    supplierTotalVnd: item.supplierTotalVnd,
    feeVnd: item.feeVnd,
    assignedAdmin: item.assignedAdmin,
    updatedAt: item.updatedAt.toISOString(),
  }))
  const open = rows.filter((row) => !isTerminalStatus(row.status))
  const closed = rows.filter((row) => isTerminalStatus(row.status))
  return (
    <section aria-labelledby="trips-queue">
      <h2 id="trips-queue" className="text-base font-bold text-foreground">Trip assistance queue</h2>
      <p className="mb-4 mt-1 max-w-3xl text-sm text-muted-foreground">
        Move a case through the lifecycle; quote the fee in the traveller&apos;s thread, not here. eno arranges only — the traveller pays suppliers directly.
      </p>
      <div className="space-y-3">
        <h3 id="trips-open" className="flex items-center gap-2 text-sm font-bold text-foreground"><Map className="h-4 w-4" aria-hidden="true" />Open ({open.length})</h3>
        <TripsQueueClient rows={open} />
      </div>
      {closed.length > 0 && (
        <div className="mt-8 space-y-3 border-t border-border pt-6">
          <h3 id="trips-closed" className="text-sm font-bold text-foreground">Closed ({closed.length})</h3>
          <TripsQueueClient rows={closed} />
        </div>
      )}
    </section>
  )
}
