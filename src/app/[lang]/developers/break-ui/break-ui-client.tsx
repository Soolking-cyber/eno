'use client'

import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { ListingCard } from '@/components/marketplace/listing-card'
import { PdpShopLink } from '@/components/marketplace/pdp-shop-link'
import { SellerCard } from '@/components/marketplace/seller-card'
import { MessageBubble } from '@/components/marketplace/chat-parts'
import { DashboardListingRow } from '@/components/marketplace/dashboard-listing-row'
import { Avatar } from '@/components/ui/avatar'
import { useMounted } from '@/hooks/use-mounted'
import { useLanguage } from '@/context/language-context'
import {
  BREAK_UI_STATES, cardsFor, dashboardRowsFor, messagesFor, metricsFor, peopleFor, type BreakUiState,
} from '@/lib/__fixtures__/break-ui'
import { BreakUiToggle } from './break-ui-toggle'

const noop = () => {}

/**
 * ⚠️ REAL COMPONENTS, REAL BUTTONS. Save, chat, offer and the dashboard row actions send their real requests, with
 * fixture ids (`bu-…`) that exist in no database. Run it the way the break-ui pass ran — a scratch DB and a fake
 * session — not signed in for real on a preview that reads production. Even there a fixture id writes nothing:
 * every route a click reaches looks the listing up first — conversations, contact, sold, status, confirm, buyers
 * and the listing itself answer 404 for an unknown id (403 for someone else's), and save moves no count for a
 * listing that is not live (favorites are device-local).
 * A page-wide fetch guard was tried and dropped (codex + opus): a monkeypatch leaks — unmount order, XHR, forms —
 * and fakes success for the app's own requests. The server contract above is the bound.
 */

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} data-break-ui={id} className="mt-10 first:mt-6">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Empty() {
  const { tr } = useLanguage()
  return <p className="text-sm text-muted-foreground">{tr('(no rows)', '(không có dòng nào)')}</p>
}

/**
 * ⛔ DEV-ONLY STRESS HARNESS for the break-ui pass: REAL components inside the containers they ship
 * in (the feed grid, the thread's row/wrapper/bubble chain, the PDP side column), with the data
 * swapped at the PROPS boundary by `?data=` — never by editing markup. Client-only render: the
 * fixtures compute relative times from `now`, which would otherwise be a hydration mismatch.
 */
// Only the card grid renders a whole long state. The other sections stop at a cap (mounting 1,000 dashboard rows
// took 38–52s), and their headings say so — "40 of 1000" — so "1,000 rows" is never read as all of them (codex).
const PEOPLE_CAP = 12, CHAT_CAP = 40, ROWS_CAP = 50, GRID_CAP = 6
const of = (cap: number, total: number) => (total > cap ? `${cap} of ${total}` : `${total}`)

export function BreakUiClient() {
  const sp = useSearchParams()
  const raw = sp.get('data')
  const state: BreakUiState = BREAK_UI_STATES.some((s) => s.key === raw) ? (raw as BreakUiState) : 'demo'
  const mounted = useMounted()
  const now = useMemo(() => Date.now(), [])
  if (!mounted) return null

  const cards = cardsFor(state, now)
  const people = peopleFor(state)
  const shown = people.slice(0, PEOPLE_CAP)
  const messages = messagesFor(state)
  const rows = dashboardRowsFor(state, now)

  return (
    <main id="main" className="mx-auto max-w-7xl px-3 pb-32 sm:px-6 lg:px-8">
      {/* The feed's own wrappers: .feed-grid › LISTING_GRID › div[data-feed-card] (listings-explorer). */}
      <Section id="cards" title={`ListingCard — feed grid (${cards.length})`}>
        {cards.length === 0 ? <Empty /> : (
          <div className="feed-grid">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
              {cards.map((l, i) => (
                <div key={l.id} data-feed-card className="flex h-full flex-col">
                  <ListingCard listing={l} onOpen={noop} priority={i < 4} />
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>

      <Section id="avatars" title={`Avatar initials (${of(PEOPLE_CAP, people.length)})`}>
        {shown.length === 0 ? <Empty /> : (
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-6">
            {shown.map((p, i) => (
              <li key={i} className="flex min-w-0 flex-col items-center gap-1.5">
                <Avatar name={p.name} color={p.color} size="lg" />
                <span className="w-full truncate text-center text-2xs text-muted-foreground">{p.name}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* The PDP seller block sits in the page column on mobile and the 380px buy box on desktop. */}
      <Section id="seller" title="Seller identity — PDP shop link + storefront card">
        {shown.length === 0 ? <Empty /> : (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[380px_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-4">
              {shown.slice(0, 6).map((p, i) => (
                <PdpShopLink key={i} name={p.name} avatarColor={p.color} isBusiness={i % 2 === 1} businessVerified={i % 3 === 1}
                  officialPartner={i === 4} href={`/s/break-ui-${i}`} metrics={metricsFor(state, i, now)} />
              ))}
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              {shown.slice(0, 3).map((p, i) => (
                <SellerCard key={i} variant="storefront" listingCount={[1, 0, 128_400][i % 3]} metrics={metricsFor(state, i, now)}
                  seller={{ id: `bu-s-${i}`, name: p.name, avatarColor: p.color, isBusiness: i !== 0, businessVerified: i === 1 }} />
              ))}
            </div>
          </div>
        )}
      </Section>

      {/* The thread's chain: scroller (chat-scroll … overflow-y-auto) › row (flex-col items-end/start)
          › wrapper (relative max-w-[80%]) › MessageBubble className="max-w-full" — messages/[id]/page.tsx. */}
      <Section id="chat" title={`Chat bubbles (${of(CHAT_CAP, messages.length)})`}>
        {messages.length === 0 ? <Empty /> : (
          <div className="mx-auto max-w-2xl rounded-2xl border border-border">
            <div className="chat-scroll h-[32rem] space-y-2 overflow-y-auto overscroll-contain px-4 py-4 scroll-thin">
              {messages.slice(0, CHAT_CAP).map((m) => (
                <div key={m.id} className={`flex flex-col pb-4 ${m.mine ? 'items-end' : 'items-start'}`}>
                  <div className="relative max-w-[80%]">
                    <MessageBubble mine={m.mine} className="max-w-full">{m.body}</MessageBubble>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>

      <Section id="dashboard" title={`Dashboard listing rows (${of(ROWS_CAP, rows.length)} · grid ${of(GRID_CAP, rows.length)})`}>
        {rows.length === 0 ? <Empty /> : (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-2">
              {rows.slice(0, ROWS_CAP).map((l) => <DashboardListingRow key={l.id} listing={l} onChanged={noop} />)}
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
              {rows.slice(0, GRID_CAP).map((l) => <DashboardListingRow key={l.id} listing={l} onChanged={noop} variant="grid" />)}
            </div>
          </div>
        )}
      </Section>

      <BreakUiToggle state={state} />
    </main>
  )
}
