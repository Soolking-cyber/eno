'use client'

// The contact strip of a TEACHER thread (2026-09-30), replacing the product "Request number" strip.
//   · teacher (seller side): "Share my phone, email & CV" / "Stop sharing" — their explicit tap, not
//     any reply, is what unlocks their details (owner decision; "no thanks" must unlock nothing);
//   · recruiter (buyer side): the shared phone, email and CV once shared, else a waiting hint.
// The server re-derives every rule from the conversation row (src/lib/teachers/share.ts).
import { useEffect, useState } from 'react'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { FileText, Phone } from '@/components/ui/icons'

type Contact = { phone: string | null; email: string | null; hasCv: boolean }

/**
 * `closed` — the thread is CLOSED by a block (App Store gate `ugc-safety`). The page then mounts the strip
 * for the TEACHER only, and only so a share made before the block can be WITHDRAWN: the strip shows "Stop
 * sharing" while a share stands and nothing otherwise — a Share button there could only be refused
 * (codex, gate round 3).
 */
export function TeacherThreadStrip({ conversationId, iAmTeacher, shared: sharedProp, live = true, shareSignal, closed = false }: { conversationId: string; iAmTeacher: boolean; shared: boolean; live?: boolean; shareSignal: number; closed?: boolean }) {
  const { tr } = useLanguage()
  const [shared, setShared] = useState(sharedProp)
  const [busy, setBusy] = useState(false)
  const [contact, setContact] = useState<Contact | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { setShared(sharedProp) }, [sharedProp])

  // ⚠️ THE RECRUITER'S SIDE ASKS THE SERVER on mount and whenever `shareSignal` moves — the count of
  // share/revoke ANNOUNCEMENTS in the thread, not of all messages. A share or revoke arrives as a
  // realtime message, never as a new thread payload, so a prop-driven strip showed a revoked phone
  // until reload; refetching on EVERY message instead drained the rate limit in a busy chat and then
  // hid details that were shared (agy + Opus, commit gate 09-30). Only `share_required` clears.
  useEffect(() => {
    if (iAmTeacher) { setContact(null); return }
    let alive = true
    fetch(`/api/teachers/contact?conversationId=${encodeURIComponent(conversationId)}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}))
        if (!alive) return
        if (r.ok) { setContact(d as Contact); setShared(true); setError('') }
        else if (r.status === 429) setError(tr('Too many requests — the contact details will load again in a few minutes.', 'Quá nhiều yêu cầu — thông tin liên hệ sẽ tải lại sau vài phút.'))
        // Any REFUSAL (403/404: not shared, not business, suspended, gone) clears what is on screen.
        // Only a rate limit or a network failure keeps it — those are not a change of permission.
        else if (r.status === 403 || r.status === 404) {
          setContact(null)
          if (d.error === 'share_required' || d.error === 'not_found') setShared(false)
          if (d.error === 'business_only') setError(tr('Only school and company accounts can see teacher contact details.', 'Chỉ tài khoản trường học hoặc công ty mới xem được liên hệ của giáo viên.'))
        }
      })
      .catch(() => {})
    return () => { alive = false }
  }, [conversationId, iAmTeacher, shareSignal])

  const toggle = async (next: boolean) => {
    // `loading` keeps the button focusable (aria-disabled), so the double-tap guard lives here.
    if (busy) return
    setBusy(true); setError('')
    try {
      const r = await fetch('/api/teachers/share', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId, share: next }) })
      if (r.ok) setShared(next)
      else {
        const code = (await r.json().catch(() => ({}))).error
        setError(code === 'profile_hidden'
          ? tr('Show your profile again before sharing your contact details.', 'Hãy hiển thị lại hồ sơ trước khi chia sẻ thông tin liên hệ.')
          // App Store gate `ugc-safety`: a block refuses a new share (the thread shows it is closed too).
          // Names the conversation, never the person.
          : code === 'blocked'
            ? tr('This conversation is closed — contact details can’t be shared here.', 'Cuộc trò chuyện này đã đóng — không thể chia sẻ thông tin liên hệ ở đây.')
            : tr('Could not update sharing. Please try again.', 'Không cập nhật được. Vui lòng thử lại.'))
      }
    } finally { setBusy(false) }
  }

  if (closed && (!iAmTeacher || !shared)) return null

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border bg-background px-4 py-2">
      {iAmTeacher ? (
        shared ? (
          <>
            <p className="text-2xs text-body">{closed
              ? tr('Your details are still shared, but this school can’t see them while the conversation is closed.', 'Thông tin của bạn vẫn đang được chia sẻ, nhưng trường không xem được khi cuộc trò chuyện đang đóng.')
              : live ? tr('This school can see your phone, email and CV.', 'Trường này xem được số điện thoại, email và CV của bạn.') : tr('Paused while your profile is hidden — the school sees nothing until it is visible again.', 'Tạm dừng khi hồ sơ bị ẩn — trường không xem được gì cho đến khi hồ sơ hiển thị lại.')}</p>
            <Button variant="ghost" size="sm" onClick={() => toggle(false)} loading={busy}>{tr('Stop sharing', 'Ngừng chia sẻ')}</Button>
          </>
        ) : (
          <>
            <Button variant="cta" size="sm" onClick={() => toggle(true)} loading={busy}>
              <Phone className="h-3.5 w-3.5" />
              {tr('Share my phone, email & CV', 'Chia sẻ số điện thoại, email và CV')}
            </Button>
            <p className="text-2xs text-muted-foreground">{tr('Only this school sees them, and you can stop any time.', 'Chỉ trường này xem được, và bạn có thể ngừng bất cứ lúc nào.')}</p>
          </>
        )
      ) : contact ? (
        <>
          {contact.phone && <a href={`tel:${contact.phone.replace(/[^+\d]/g, '')}`} className="press flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-foreground hover:bg-muted"><Phone className="h-3.5 w-3.5" /> {contact.phone}</a>}
          {contact.email && <a href={`mailto:${contact.email}`} className="rounded-full px-3 py-1.5 text-xs font-bold text-foreground hover:bg-muted">{contact.email}</a>}
          {contact.hasCv && <a href={`/api/teachers/cv?conversationId=${encodeURIComponent(conversationId)}`} target="_blank" rel="noopener" className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-foreground hover:bg-muted"><FileText className="h-3.5 w-3.5" /> {tr('Download CV', 'Tải CV')}</a>}
        </>
      ) : (
        <p className="flex items-center gap-1.5 text-2xs text-body">
          <Phone className="h-3.5 w-3.5 shrink-0 text-ink-4" />
          {tr('The teacher’s phone, email and CV appear here if they choose to share them with you.', 'Số điện thoại, email và CV của giáo viên sẽ hiện ở đây nếu họ đồng ý chia sẻ.')}
        </p>
      )}
      {error && <p role="alert" className="w-full text-2xs text-destructive">{error}</p>}
    </div>
  )
}
