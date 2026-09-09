'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

export type SupportThreadRow = {
  id: string
  who: string
  /** E.164 without '+', as Meta sends it. null = this thread never came from WhatsApp. */
  waId: string | null
  lastInboundAt: string | null
  preview: string
  lastAt: string | null
  unread: number
}

/**
 * ⚠️ `fromCustomer`, NOT `mine`. The wire's `mine` answers "did THIS session send it", which on a
 * shared desk turns a colleague's earlier reply into a customer message. The page computes this
 * against `buyerProfileId` instead — see the note there.
 */
export type SupportMsg = { id: string; fromCustomer: boolean; body: string; deleted: boolean; createdAt: string }

const WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * ⛔ THIS COMPONENT HOLDS ONE PIECE OF STATE — THE DRAFT — AND ITS CALLER MUST KEY IT ON THE OPEN
 * THREAD ID. Selection is a <Link>, but that is a SOFT navigation inside one route segment: React
 * reconciles this component and `useState` survives it, so without the key an operator's reply to
 * A is still sitting in the box when B is opened, and Enter sends it to B over WhatsApp. The key
 * lives at the call site (admin/support/page.tsx) because that is where the id is known.
 * Admin chrome is EN-only by convention (CLAUDE.md), so nothing here goes through tr().
 */
export function SupportInbox({ rows, open, messages }: { rows: SupportThreadRow[]; open: SupportThreadRow | null; messages: SupportMsg[] }) {
  const router = useRouter()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [messages])

  /**
   * ⚠️ REFETCH WHEN THE TAB COMES BACK, rather than polling or opening a realtime socket. An
   * operator leaves this open all day; a socket per operator buys seconds on a queue measured in
   * minutes, and a timer runs against the database forever for the same. `router.refresh()` re-runs
   * the server component, so the list, the badges and the transcript all move together.
   */
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') router.refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [router])

  const send = async () => {
    const body = text.trim()
    if (!body || !open || busy) return
    setBusy(true); setErr(null)
    try {
      const res = await fetch(`/api/conversations/${open.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string }
        setErr(j.error === 'forbidden'
          ? 'This account is not on ADMIN_EMAILS for this edition.'
          : `Send failed (${j.error ?? res.status})`)
        return
      }
      setText('')
      router.refresh()
    } catch { setErr('Send failed') } finally { setBusy(false) }
  }

  // Advisory only — Meta measures its own window on its own clock. See the note in the page.
  const windowClosed = !!open?.lastInboundAt && Date.now() - Date.parse(open.lastInboundAt) > WINDOW_MS

  if (!rows.length) {
    return <Card className="p-6 text-sm text-muted-foreground">No support threads yet. A WhatsApp message to the business number opens one.</Card>
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
      <Card className="max-h-[70vh] overflow-y-auto p-0">
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                href={`/admin/support?t=${r.id}`}
                scroll={false}
                /**
                 * ⛔ `prefetch={false}` OR THE LIST MARKS ITSELF READ. Opening a thread is what
                 * clears the desk's unread, and that happens while the SERVER COMPONENT renders —
                 * so a prefetch, which renders the target route without anyone opening it, would
                 * silently zero the unread of every thread that merely scrolled into view. The
                 * queue would look handled while nobody had read a word: exactly the failure this
                 * page was built to end, reintroduced through the router.
                 */
                prefetch={false}
                className={`flex w-full flex-col items-start gap-0.5 px-4 py-3 text-left transition-colors hover:bg-muted ${r.id === open?.id ? 'bg-muted' : ''}`}
              >
                <span className="flex w-full items-center gap-2">
                  <span className="truncate font-semibold text-foreground">{r.who}</span>
                  {r.unread > 0 && <span className="ml-auto shrink-0 rounded-full bg-accent px-1.5 text-2xs font-bold text-accent-foreground">{r.unread}</span>}
                </span>
                <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {r.waId ? `WhatsApp +${r.waId}` : 'In-app'}
                </span>
                <span className="line-clamp-1 text-xs text-muted-foreground">{r.preview}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="flex max-h-[70vh] flex-col p-0">
        {!open ? (
          <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
            Pick a thread to read it. Opening one marks it read for the desk.
          </div>
        ) : (
          <>
            <div className="border-b border-border px-4 py-3">
              <div className="font-semibold text-foreground">{open.who}</div>
              <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                {open.waId ? `WhatsApp +${open.waId}` : 'In-app only — a reply stays in the app'}
              </div>
            </div>

            <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${m.fromCustomer ? 'bg-muted text-foreground' : 'ml-auto bg-accent text-accent-foreground'}`}
                >
                  {m.deleted ? <em className="text-muted-foreground">removed</em> : m.body}
                </div>
              ))}
              <div ref={endRef} />
            </div>

            {windowClosed && (
              <div className="border-t border-border px-4 py-2 text-xs text-foreground">
                Their last WhatsApp message was over 24 hours ago. WhatsApp refuses free text outside that
                window, so this reply will land in the app but probably not on their phone.
              </div>
            )}
            {err && <div className="border-t border-border px-4 py-2 text-xs text-destructive">{err}</div>}

            <div className="flex items-end gap-2 border-t border-border p-3">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                /**
                 * ⚠️ `isComposing` OR VIETNAMESE TYPING IS BROKEN. Telex/VNI compose a tone mark
                 * across keystrokes, and Enter is how an IME COMMITS the syllable — sending on it
                 * would fire mid-word and post a half-typed reply to a customer.
                 */
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() }
                }}
                rows={2}
                placeholder="Reply…"
                className="min-h-[2.5rem] flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:border-accent"
              />
              <Button onClick={() => void send()} disabled={busy || !text.trim()}>{busy ? 'Sending…' : 'Send'}</Button>
            </div>
          </>
        )}
      </Card>
    </div>
  )
}
