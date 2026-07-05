import { AdminDenied } from '@/components/admin/admin-denied'
import { db } from '@/lib/db'
import { getAdmin } from '@/lib/admin'
import { ChevronLeft, Tag } from 'lucide-react'
import Link from 'next/link'
import { formatMoneyFull } from '@/lib/vnd'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Conversation — eno.vn moderation',
  robots: { index: false, follow: false },
}

type Props = { params: Promise<{ id: string }> }

const fmt = (d: Date) => d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

// Read-only admin view of a reported conversation — opened from a report's "View
// conversation" link so a moderator can read the actual exchange before deciding.
// Admin-gated; nothing here is editable.
export default async function AdminConversationPage({ params }: Props) {
  const { id } = await params
  const admin = await getAdmin()

  if (!admin) {
    return <AdminDenied />
  }

  const convo = await db.conversation.findUnique({
    where: { id },
    select: {
      id: true,
      buyerProfileId: true,
      sellerProfileId: true,
      buyer: { select: { displayName: true, email: true } },
      seller: { select: { id: true, name: true } },
      listing: { select: { id: true, title: true } },
      messages: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, senderProfileId: true, body: true, kind: true, offerAmount: true, offerStatus: true, createdAt: true },
      },
    },
  })

  const buyerName = convo?.buyer?.displayName || convo?.buyer?.email || 'Buyer'
  const sellerName = convo?.seller?.name || 'Seller'

  return (
    <div className="flex flex-1 flex-col bg-background">
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-2xl flex-1 px-3 py-8 sm:px-6 lg:px-8">
        <Link href="/admin" className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-accent-foreground">
          <ChevronLeft className="h-4 w-4" /> Back to moderation
        </Link>

        {!convo ? (
          <div className="rounded-2xl border border-dashed border-border py-16 text-center text-sm text-ink-4">
            Conversation not found (it may have been deleted).
          </div>
        ) : (
          <div className="rounded-2xl bg-card p-4 shadow-pop sm:p-6">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <h1 className="text-base font-bold text-foreground">
                <span className="text-accent-foreground">{buyerName}</span>
                <span className="text-ink-4"> ↔ </span>
                {convo.seller ? (
                  <a href={`/sellers/${convo.seller.id}`} target="_blank" rel="noreferrer" className="text-accent-foreground hover:underline">{sellerName}</a>
                ) : (
                  <span className="text-accent-foreground">{sellerName}</span>
                )}
              </h1>
              <span className="rounded-full bg-tint px-2 py-0.5 text-[11px] font-semibold text-ink-4">read-only</span>
            </div>
            {convo.listing && (
              <a href={`/listings/${convo.listing.id}`} target="_blank" rel="noreferrer" className="text-xs text-accent-foreground hover:underline">
                Re: {convo.listing.title}
              </a>
            )}

            <div className="mt-4 space-y-2 border-t border-border pt-4">
              {convo.messages.length === 0 && (
                <p className="py-10 text-center text-xs text-ink-4">No messages in this thread.</p>
              )}
              {convo.messages.map((m) => {
                const fromBuyer = m.senderProfileId === convo.buyerProfileId
                const who = fromBuyer ? buyerName : sellerName
                return (
                  <div key={m.id} className={`flex flex-col ${fromBuyer ? 'items-start' : 'items-end'}`}>
                    <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${fromBuyer ? 'bg-tint text-foreground' : 'bg-primary/10 text-foreground'}`}>
                      {m.kind === 'offer' ? (
                        <>
                          {/* Offer line derived from the structured offerAmount — legacy
                              messages carry a baked "💰 Offered …₫" body (skip it); new
                              offer bodies hold only the sender's optional note. */}
                          <span className="inline-flex items-center gap-1 font-semibold">
                            <Tag className="h-3.5 w-3.5" /> Offered {formatMoneyFull(m.offerAmount || 0, '₫')}
                            {m.offerStatus ? <span className="text-xs font-normal text-ink-4">· {m.offerStatus}</span> : null}
                          </span>
                          {m.body && !m.body.startsWith('💰') && <div className="mt-1">{m.body}</div>}
                        </>
                      ) : (
                        m.body
                      )}
                    </div>
                    <span className="mt-0.5 px-1 text-[10px] text-ink-4">{who} · {fmt(m.createdAt)}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
