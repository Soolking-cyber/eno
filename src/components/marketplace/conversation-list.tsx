'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, usePathname } from 'next/navigation'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { useChat } from '@/context/chat-context'
import { MessagesGuestGate } from '@/components/marketplace/messages-guest-gate'
import { Search, Trash2, X, Sparkles, Check, Undo2, Tag } from '@/components/ui/icons'
import { Mascot } from './mascot'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { Badge } from '@/components/ui/badge'
import { IconButton } from '@/components/ui/icon-button'
import { CloseButton } from '@/components/ui/close-button'
import { Input } from '@/components/ui/input'
import { formatMoneyFull, moneyLocale } from '@/lib/vnd'

// Borderless conversation list — the left pane of the desktop two-pane messenger
// (and the whole screen on mobile). Highlights the open thread on desktop.
export function ConversationList() {
  const { user, loading } = useAuth()
  // Known to be signed out. While auth is still `loading`, `html.no-session` (set pre-paint when the
  // document had no sb- cookie) is what lets the guest state paint before hydration — see below.
  const guest = !loading && !user
  const { lang, tr } = useLanguage()
  const { convos, deleteConvo, refreshConvos, prefetchThread } = useChat()
  const { id: activeId } = useParams<{ id?: string }>()
  const pathname = usePathname()
  const aiActive = pathname === '/messages/ai'
  const [confirmId, setConfirmId] = useState<string | null>(null)
  /**
   * Rows on their way out. A confirmed delete used to remove the row in the same commit, so it
   * vanished and every row below jumped up a slot. It now fades and collapses its height over 150ms
   * (opacity + grid-rows 1fr→0fr — the list-removal pair), THEN is deleted. Exit only: a row
   * restored by Undo reappears as it always did. Reduced motion collapses it at once (global guard).
   * The confirm stays up while the row leaves (clearing it first flashed the trash icon back for
   * the whole fade), and the leaving row is `inert`, so neither a second Enter nor a Tab can reach
   * a thread that is being deleted. A list unmounted mid-fade still deletes: the user confirmed.
   */
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(() => new Set())
  const removeRow = (id: string) => {
    if (leaving.has(id)) return
    setLeaving((cur) => new Set(cur).add(id))
    window.setTimeout(() => {
      deleteConvo(id)
      setConfirmId((cur) => (cur === id ? null : cur))
      setLeaving((cur) => { const next = new Set(cur); next.delete(id); return next })
    }, 150)
  }
  const [query, setQuery] = useState('')

  useEffect(() => { if (user) refreshConvos() }, [user, refreshConvos])

  const filtered = useMemo(() => {
    if (!convos) return convos
    const q = query.trim().toLowerCase()
    // Stable newest-first order (`convos` is already recency-sorted). We deliberately
    // do NOT re-sort by unread/active: doing so made the clicked thread jump to the
    // top of the list (and an unread thread jump down the instant opening it marked it
    // read). Unread threads are already unmistakable via the blue rail + count badge +
    // accent background, so opening a conversation now leaves the list order untouched —
    // only genuinely new activity (a fresh message bumping recency) reorders it.
    return q
      ? convos.filter((c) => `${c.counterpart.name} ${c.listingTitle} ${c.lastMessageText ?? ''}`.toLowerCase().includes(q))
      : convos
  }, [convos, query])

  return (
    <div className="flex h-full flex-col">
      <div className="px-2 pt-3">
        {/* Title only on desktop; on mobile the navbar gives context + the search
            sits right under it. ⚠️ `max-lg:sr-only`, NOT `hidden lg:block`: display:none took the h1
            out of the accessibility tree too, so a phone screen reader met /messages with no page
            heading at all (the same fix DashboardTabs records). Visually nothing changes. */}
        <PageHeader title={tr('Messages', 'Tin nhắn')} className="px-1" titleClassName="max-lg:sr-only" />
        {/* Search — filled, borderless. ⚠️ NOT FOR A GUEST: there is nothing of theirs to search, and a
            search box above a sign-in gate reads as a broken inbox. Pre-hydration, `no-session:hidden`
            drops it for a cookie-less document while auth is still loading. */}
        {!guest && (
        <div className={cn('relative lg:mt-3', loading && 'no-session:hidden')}>
          {/* Input lead rides the 20px step (icon-language §4: inputs = h-5). */}
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-4" aria-hidden />
          <Input
            variant="filled"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr('Search messages', 'Tìm tin nhắn')}
            autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
            aria-label={tr('Search messages', 'Tìm tin nhắn')}
            className="py-2.5 pl-10 pr-4 transition-colors focus:bg-muted focus:ring-0"
          />
        </div>
        )}
      </div>

      <div className="mt-2 flex-1 overflow-y-auto px-2 pb-4 scroll-thin">
        {/* eno AI — pinned at the top; always available (a chat with the AI assistant). */}
        <Link
          href="/messages/ai"
          scroll={false}
          className={cn('mb-1 flex items-center gap-3 rounded-xl p-2.5 transition-colors active:bg-tint/60', aiActive ? 'bg-muted text-accent-foreground' : 'hover:bg-muted')}
        >
          {/* The chrome coin (icon-language §6), not a solid disc: fully-saturated brand is
              reserved for user-state (§5 — the unread rail/badge in the rows below), so the
              always-on AI avatar sits on the same flat brand-50 coin as the nav's Post chip. */}
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand"><Sparkles className="h-5 w-5" aria-hidden /></span>
          <div className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold text-foreground">{tr('eno AI', 'eno AI')}</span>
            <p className="truncate text-xs text-accent-foreground">{tr('Ask anything — find products by chat', 'Hỏi bất cứ điều gì — tìm đồ bằng chat')}</p>
          </div>
        </Link>
        {/* ⚠️ ONE GATE PER SCREEN: on a phone it lives here (the list IS the page); from lg the right
            pane shows it (messages/page.tsx), so this copy is `lg:hidden` — desktop used to show two
            mascots and two sign-in buttons side by side. */}
        {guest ? (
          <div className="lg:hidden"><MessagesGuestGate /></div>
        ) : convos === null ? (
          loading ? (
            /* ⛔ AUTH STILL RESOLVING — THE GATE PAINTS FROM THE FIRST FRAME FOR A COOKIE-LESS DOCUMENT.
               `loading` is true on the server and on the first client render, and only flips after
               hydration (auth-context boots Supabase in an effect), so a guest used to watch six
               skeleton rows for ~1s before the gate replaced them. `html.no-session` is known BEFORE
               paint, so CSS picks the branch: skeletons for a document with a session cookie, the gate
               without one. Server and first client render emit this same markup, so there is no
               hydration mismatch; once `loading` flips, the branches above take over. */
            <>
              <div className="space-y-1.5 px-1 no-session:hidden">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
              <div className="lg:hidden"><MessagesGuestGate className="hidden no-session:flex" /></div>
            </>
          ) : (
            <div className="space-y-1.5 px-1">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
          )
        ) : convos.length === 0 ? (
          // ⚠️ THE SHARED EMPTY STATE, WITH A TITLE AND A WAY FORWARD (D-STATES, 2026-09-29): this was a
          // mascot over one muted sentence and nothing to tap — the inbox told a new user to go and
          // find a listing and gave them no door to it. `bare`: the flat canon, no box around it.
          <EmptyState
            tone="bare"
            size="lg"
            media={<Mascot name="chat" className="mx-auto h-40 w-40" />}
            title={tr('No messages yet', 'Chưa có tin nhắn')}
            subtitle={tr('Tap "Message" on any listing to start a chat.', 'Nhấn "Nhắn tin" trên một tin đăng để bắt đầu trò chuyện.')}
            action={
              <Button asChild variant="cta" size="none">
                <Link href="/" className="px-5 py-2.5">{tr('Browse listings', 'Khám phá tin đăng')}</Link>
              </Button>
            }
          />
        ) : filtered && filtered.length === 0 ? (
          <EmptyState tone="bare" title={tr('No conversations match.', 'Không có cuộc trò chuyện phù hợp.')} />
        ) : (
          <div className="space-y-0.5">
            {(filtered ?? []).map((c) => (
              <div
                key={c.id}
                inert={leaving.has(c.id)}
                className={cn(
                  // `grid-cols-[minmax(0,1fr)]`: a bare `grid` gets one `auto` column that grows to
                  // the row's min-content — a long one-line preview's full width — and the
                  // `truncate` inside stops truncating. `mb-0` collapses the list's `space-y` gap
                  // with the row, so nothing below snaps up by it when the row is finally removed.
                  'grid grid-cols-[minmax(0,1fr)] transition-[grid-template-rows,opacity,margin] duration-150 ease-out',
                  leaving.has(c.id) ? 'pointer-events-none mb-0 grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr]',
                )}
              >
              <div
                onMouseEnter={() => prefetchThread(c.id)}
                onFocus={() => prefetchThread(c.id)}
                onTouchStart={() => prefetchThread(c.id)}
                /**
                 * ⛔ A STANDING OFFER IS A DISTINCT ROW STATE, NOT A SHADE OF UNREAD. Owner,
                 * 2026-08-16: "for unanswered offers have some state on left messages panel where
                 * user can clearly see if they have standing offer … have same or another color
                 * background when offer is not accepted countered or declined".
                 *
                 * The two states answer different questions and must not share a colour. Unread
                 * asks "has something arrived?" and is cleared by looking. A pending offer asks
                 * "does someone owe an answer?" and is cleared only by accepting, declining or
                 * countering — it survives being read, and it is the one that costs money to
                 * forget. So it gets a warning tint, sitting ABOVE unread in the cascade: a thread
                 * that is both is shown as the offer, because that is the state with a deadline.
                 *
                 * ⚠️ `bg-warning/15`, AND THAT EXACT UTILITY FOR A REASON. The first attempt wrote
                 * `bg-warning-soft`, which does not exist anywhere in this codebase — Tailwind emits
                 * nothing for it, so the row would have rendered with NO background while tsc,
                 * eslint and design-lint all passed. The established pair here is `bg-warning/10`
                 * (27 uses) and `/15`; the stronger one is used because this row competes with
                 * `bg-accent` unread rows for attention and must win.
                 *
                 * ⚠️ `pending` IS THE ONLY STATUS THAT QUALIFIES. accepted / declined / countered
                 * are all resolved — a countered offer has already been answered, and the counter
                 * itself becomes the new last message with its own pending status if it is live.
                 */
                className={cn(
                  'group relative flex min-h-0 items-center gap-1 rounded-xl transition-colors',
                  // Clipped only while collapsing, so focus rings are never cut at rest.
                  leaving.has(c.id) && 'overflow-hidden',
                  // ⚠️ PENDING OUTRANKS ACTIVE, and that ordering is the owner's requirement, not a
                  // detail. Reviewer-caught: with `activeId` first, merely OPENING the thread
                  // replaced the tint with `bg-muted` — so the one state that is supposed to
                  // survive being looked at was cleared by looking at it. Only accepting, declining
                  // or countering may clear it.
                  // ⚠️ INCOMING ONLY — `!mine`. Owner, 2026-08-16: "when someone sent you offer but
                  // you didnt click any options accept decline or counter". The first cut keyed on
                  // status alone, which a reviewer had already flagged: a person who SENT an offer
                  // and is waiting on the other side saw the same urgent tint as someone sitting on
                  // an unanswered one. Only the recipient can clear this state, so only the
                  // recipient should carry it.
                  c.lastOffer?.status === 'pending' && !c.lastOffer.mine
                    ? 'bg-warning/15 hover:bg-warning/20'
                    : activeId === c.id
                      ? 'text-accent-foreground bg-muted'
                      : c.unread > 0
                        ? 'bg-accent hover:bg-accent'
                        : 'hover:bg-muted',
                )}
              >
                {/* Unread → clear blue left rail so the new thread to reply to stands out. */}
                {c.unread > 0 && activeId !== c.id && (
                  <span aria-hidden className="absolute inset-y-2 left-0 w-1 rounded-full bg-accent-foreground" />
                )}
                {/* `active:` on the LINK, not the row: the row's hover tints never fire on a phone, so
                    a tap showed nothing until the thread painted — and `:active` on the wrapper would
                    also flash while pressing the delete button beside it. */}
                <Link href={`/messages/${c.id}`} scroll={false} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-2.5 transition-colors active:bg-tint/60">
                  <Avatar name={c.counterpart.name} url={c.counterpart.avatarUrl} size="md" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-bold text-foreground">{c.counterpart.name}</span>
                      {c.unread > 0 && <Badge variant="counter-brand" size="count" className="h-5 min-w-5 px-1.5">{c.unread}</Badge>}
                    </div>
                    {/* ⚠️ THE LABEL EXISTS BECAUSE THE COUNTERPART NAME CANNOT DISTINGUISH THESE.
                        The visa desk and the trip desk are ONE Seller row, so both threads show the
                        identical "eno Vietnam" and the same avatar — measured: 6 of 23 live
                        conversations. Without this a traveller has no way to tell their passport
                        application from their holiday plan in the list. The kind comes from the
                        server's threadKind; 'listing' (an ordinary marketplace chat) gets no badge,
                        because there is nothing to disambiguate. */}
                    <div className="flex min-w-0 items-center gap-1.5">
                      {(c.kind === 'visa' || c.kind === 'itinerary') && (
                        <Badge size="sm" className="shrink-0 bg-tint text-body">
                          {c.kind === 'visa' ? tr('Visa', 'Thị thực') : tr('Trip', 'Chuyến đi')}
                        </Badge>
                      )}
                      <p className="truncate text-xs text-ink-4">{c.listingTitle}</p>
                    </div>
                    {(() => {
                      const o = c.lastOffer
                      // Make offer direction + status legible at a glance: an incoming
                      // pending offer ("New offer") is the actionable one and stands out.
                      const amt = o ? formatMoneyFull(o.amount || 0, '₫', moneyLocale(lang)) : ''
                      // Offer states lead with a 14px line glyph instead of the old ✅/❌/↩️/💰
                      // emoji — same signal, but ink that inherits the row's colour and theme
                      // (icon-language §1; preview LABELS may change, message BODIES may not —
                      // the /^(💰|✅|❌)/ realtime sniff reads bodies, never this label).
                      const OfferIcon = o
                        ? o.status === 'accepted' ? Check
                          : o.status === 'declined' ? X
                          : o.status === 'countered' ? Undo2
                          : o.mine ? null
                          : Tag
                        : null
                      const label = o
                        ? o.status === 'accepted' ? tr('Offer accepted', 'Đã chấp nhận đề nghị')
                          : o.status === 'declined' ? tr('Offer declined', 'Đã từ chối đề nghị')
                          : o.status === 'countered' ? tr('Counter-offer', 'Đã trả giá khác')
                          : o.mine ? `${tr('You offered', 'Bạn đề nghị')} ${amt}`
                          : `${tr('New offer', 'Đề nghị mới')}: ${amt}`
                        : (c.lastMessageText || tr('New conversation', 'Cuộc trò chuyện mới'))
                      const incoming = !!o && o.status === 'pending' && !o.mine
                      return (
                        <p className={cn('flex min-w-0 items-center gap-1 text-xs', incoming ? 'font-bold text-accent-foreground' : c.unread > 0 ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
                          {OfferIcon && (
                            <OfferIcon
                              className={cn('h-3.5 w-3.5 shrink-0', o?.status === 'accepted' && 'text-success', o?.status === 'declined' && 'text-destructive')}
                              aria-hidden
                            />
                          )}
                          <span className="truncate">{label}</span>
                        </p>
                      )
                    })()}
                  </div>
                </Link>
                {confirmId === c.id ? (
                  <div className="flex shrink-0 items-center gap-1 pr-2 pl-1">
                    <Button variant="destructive" size="none" onClick={() => removeRow(c.id)} className="cursor-pointer rounded-xl px-3 py-1.5 text-xs font-bold active:scale-[0.96]">{tr('Delete', 'Xóa')}</Button>
                    <CloseButton size="xs" onClick={() => setConfirmId(null)} label={tr('Cancel', 'Hủy')} />
                  </div>
                ) : (
                  <IconButton
                    size="sm"
                    onClick={() => setConfirmId(c.id)}
                    aria-label={tr('Delete conversation', 'Xóa cuộc trò chuyện')}
                    // Hidden-until-hover only where a fine pointer can hover it back (see the same
                    // note in notification-bell.tsx): `sm:opacity-0` hid it on iPads and landscape
                    // phones too, where the invisible 44px target still opened the delete confirm.
                    className="mr-2 ml-1 text-ink-4 transition hover:bg-destructive/10 hover:text-destructive hover-pointer:pointer-events-none hover-pointer:opacity-0 hover-pointer:group-hover:pointer-events-auto hover-pointer:group-hover:opacity-100 hover-pointer:focus-visible:pointer-events-auto hover-pointer:focus-visible:opacity-100"
                  >
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                )}
              </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
