'use client'

import { useState } from 'react'
import { MessageCircle, Phone, Lock, Loader2 } from 'lucide-react'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

type Contact = { phone: string; telHref: string; zaloHref: string }

/**
 * Auth-gated contact. The seller's number is NEVER in the page payload — a
 * logged-in user reveals it via POST /api/listings/[id]/contact (which logs the
 * lead). Messaging-first: "Message" is the primary CTA. Used on the listing
 * detail page, the detail dialog, and (compact) the mobile sticky bar.
 */
export function RevealContact({ listingId, compact = false }: { listingId: string; compact?: boolean }) {
  const { user, loading, openSignIn } = useAuth()
  const { tr } = useLanguage()
  const [contact, setContact] = useState<Contact | null>(null)
  const [busy, setBusy] = useState(false)

  const reveal = async (): Promise<Contact | null> => {
    if (contact) return contact
    if (!user) { openSignIn(); return null }
    setBusy(true)
    try {
      const res = await fetch(`/api/listings/${listingId}/contact`, { method: 'POST' })
      if (res.status === 401) { openSignIn(); return null }
      if (res.status === 429) { toast.error(tr('Too many requests — try again later.', 'Quá nhiều yêu cầu — thử lại sau.')); return null }
      if (!res.ok) { toast.error(tr('Could not load contact.', 'Không tải được liên hệ.')); return null }
      const data = (await res.json()) as Contact
      setContact(data)
      return data
    } finally {
      setBusy(false)
    }
  }

  const onMessage = async () => { const c = await reveal(); if (c) window.open(c.zaloHref, '_blank', 'noopener') }
  const onCall = async () => { const c = await reveal(); if (c) window.location.href = c.telHref }

  // ── Logged-out: a single primary "sign in to contact" CTA ──
  if (!loading && !user) {
    if (compact) {
      return (
        <button onClick={() => openSignIn()} className="flex items-center justify-center gap-2 rounded-full bg-[#0a66c2] px-5 py-2.5 text-sm font-bold text-white">
          <Lock className="h-4 w-4" /> {tr('Sign in', 'Đăng nhập')}
        </button>
      )
    }
    return (
      <button
        onClick={() => openSignIn()}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-[#0a66c2] py-2.5 text-sm font-bold text-white hover:bg-[#004182] active:scale-98 transition-all cursor-pointer"
      >
        <Lock className="h-4 w-4" /> {tr('Sign in to contact seller', 'Đăng nhập để liên hệ người bán')}
      </button>
    )
  }

  // ── Compact (mobile sticky bar): Message + Call icons ──
  if (compact) {
    return (
      <>
        <button onClick={onMessage} disabled={busy} className="flex items-center justify-center gap-2 rounded-full bg-[#0a66c2] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />} {tr('Message', 'Nhắn tin')}
        </button>
        <button onClick={onCall} disabled={busy} aria-label={tr('Call', 'Gọi')} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-slate-300 text-[#1a202c] disabled:opacity-60">
          <Phone className="h-4 w-4" />
        </button>
      </>
    )
  }

  // ── Full: Message (primary) + Call, plus the revealed number once shown ──
  return (
    <div className="space-y-2">
      <div className="flex gap-2.5">
        <button
          onClick={onMessage}
          disabled={busy || loading}
          className="flex flex-1 items-center justify-center gap-2 rounded-full bg-[#0a66c2] py-2.5 text-sm font-bold text-white hover:bg-[#004182] active:scale-98 transition-all cursor-pointer disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />} {tr('Message', 'Nhắn tin')}
        </button>
        <button
          onClick={onCall}
          disabled={busy || loading}
          className="flex items-center justify-center gap-2 rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-bold text-[#1a202c] hover:bg-slate-50 active:scale-98 transition-all cursor-pointer disabled:opacity-60"
        >
          <Phone className="h-4 w-4" /> {tr('Call', 'Gọi')}
        </button>
      </div>
      <p className={cn('text-center text-xs', contact ? 'font-semibold text-[#1a202c]' : 'text-[#94a3b8]')}>
        {contact ? contact.phone : tr('Contact revealed after you message or call.', 'Số liên hệ hiện sau khi bạn nhắn tin hoặc gọi.')}
      </p>
    </div>
  )
}
