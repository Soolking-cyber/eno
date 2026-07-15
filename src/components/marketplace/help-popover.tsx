'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { X, ArrowRight, ArrowLeft, CheckCircle2 } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

type View = 'menu' | { kind: 'feedback' | 'technical' }

/** Quick Help sheet opened from the floating "?" button — a fast hub to the Help
 *  Center, reporting, and feedback (bottom-sheet on mobile, centered card on
 *  desktop). Feedback / technical reports post to /admin/feedback, not email. */
export function HelpPopover({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { tr } = useLanguage()
  const [view, setView] = useState<View>('menu')
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  // DialogPrimitive handles Escape, scroll-lock, and focus trap/return natively.

  // CONTROLLED open (not a `{open && …}` mount in the parent) so Base UI drives its own
  // unmount and the data-closed exit animation actually plays — a conditional unmount would
  // rip the node out before it could animate (the House Trap). Because the component now stays
  // mounted across opens, reset the view/form on each OPEN so it starts fresh (matching the old
  // remount behaviour). Reset DURING RENDER (the store-previous-prop pattern), not in an effect:
  // an effect fires AFTER paint, so it would flash the stale 'sent'/form view for one frame
  // before flipping to the menu. Only the OPEN edge resets — closing leaves the content intact so
  // it stays stable through the exit animation.
  const [wasOpen, setWasOpen] = useState(open)
  // Bumped on every reset so an in-flight send() that resolves AFTER a close+reopen can detect it
  // belongs to a stale session and drop its result — the component now stays mounted across opens,
  // so (unlike the old unmount) a late setState WOULD otherwise clobber the fresh form.
  const sendEpoch = useRef(0)
  if (open !== wasOpen) {
    setWasOpen(open)
    // Bump on BOTH edges: closing must also invalidate an in-flight send, or a fetch resolving
    // during the exit animation would flash the form to the success screen mid-fade-out.
    sendEpoch.current++
    if (open) { setView('menu'); setMessage(''); setEmail(''); setState('idle') }
  }

  const isForm = typeof view === 'object'
  const kind = isForm ? view.kind : 'feedback'

  const send = async () => {
    if (message.trim().length < 2 || state === 'sending') return
    const epoch = sendEpoch.current
    setState('sending')
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          message: message.trim(),
          email: email.trim() || undefined,
          url: typeof window !== 'undefined' ? window.location.href : undefined,
        }),
      })
      // Dropped if the user closed and reopened (fresh session) while this was in flight.
      if (sendEpoch.current !== epoch) return
      setState(res.ok ? 'sent' : 'error')
    } catch {
      if (sendEpoch.current !== epoch) return
      setState('error')
    }
  }

  const openForm = (k: 'feedback' | 'technical') => { setView({ kind: k }); setState('idle') }
  const backToMenu = () => { setView('menu'); setMessage(''); setEmail(''); setState('idle') }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-[2px] data-open:animate-in data-open:fade-in data-closed:animate-out data-closed:fade-out" />
        <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-4">
          <DialogPrimitive.Popup className="relative w-full max-h-[85vh] overflow-y-auto rounded-t-2xl bg-card shadow-overlay outline-none duration-200 data-open:animate-in data-open:fade-in data-open:slide-in-from-bottom-4 data-closed:animate-out data-closed:fade-out-0 data-closed:slide-out-to-bottom-4 sm:max-w-md sm:rounded-2xl sm:data-open:slide-in-from-bottom-0 sm:data-open:zoom-in-95 sm:data-closed:slide-out-to-bottom-0 sm:data-closed:zoom-out-95">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-5 py-4">
          {isForm ? (
            <Button variant="bare" size="none" type="button" onClick={backToMenu} aria-label={tr('Back', 'Quay lại')} className="flex items-center justify-start gap-1.5 whitespace-normal text-base font-bold text-foreground cursor-pointer">
              <ArrowLeft className="h-5 w-5" /> {tr('Help', 'Trợ giúp')}
            </Button>
          ) : (
            <span className="text-base font-bold text-foreground">{tr('Help', 'Trợ giúp')}</span>
          )}
          <IconButton size="sm" onClick={onClose} aria-label={tr('Close', 'Đóng')} className="text-body transition-colors hover:bg-muted">
            <X className="h-5 w-5" />
          </IconButton>
        </div>

        {/* Menu */}
        {!isForm && (
          <div className="space-y-7 px-5 py-5">
            <section>
              <h2 className="text-lg font-bold text-foreground">{tr('How can we help you?', 'Chúng tôi có thể giúp gì?')}</h2>
              <p className="mt-2 text-sm leading-relaxed text-body">
                {tr('Find answers about buying, selling and your account — or contact us for more help.', 'Tìm câu trả lời về mua, bán và tài khoản — hoặc liên hệ để được hỗ trợ thêm.')}
              </p>
              <Button asChild variant="cta" size="none">
                <Link href="/help" onClick={onClose} className="mt-4 w-full px-5 py-3">
                  {tr('Visit Help Center', 'Đến Trung tâm trợ giúp')}
                </Link>
              </Button>
            </section>

            <section>
              <h2 className="text-base font-bold text-foreground">{tr('Report content', 'Báo cáo nội dung')}</h2>
              <p className="mt-2 text-sm leading-relaxed text-body">
                {tr('If a listing breaks our policies or the law, report it so we can keep eno.vn safe for everyone.', 'Nếu một tin đăng vi phạm chính sách hoặc pháp luật, hãy báo cáo để chúng tôi giữ eno.vn an toàn cho mọi người.')}
              </p>
              <Link href="/safety" onClick={onClose} className="mt-3 flex w-full items-center justify-center rounded-xl border border-brand px-5 py-2.5 text-sm font-bold text-accent-foreground transition-colors hover:bg-accent">
                {tr('How to report a listing', 'Cách báo cáo tin đăng')}
              </Link>
            </section>

            <section>
              <h2 className="text-base font-bold text-foreground">{tr('Let us know', 'Cho chúng tôi biết')}</h2>
              <div className="mt-2.5 space-y-3">
                <Button variant="bare" size="none" type="button" onClick={() => openForm('feedback')} className="flex items-center justify-start gap-1.5 whitespace-normal text-sm font-bold text-accent-foreground hover:underline cursor-pointer">
                  {tr('Send feedback', 'Gửi phản hồi')} <ArrowRight className="h-4 w-4" />
                </Button>
                <Button variant="bare" size="none" type="button" onClick={() => openForm('technical')} className="flex items-center justify-start gap-1.5 whitespace-normal text-sm font-bold text-accent-foreground hover:underline cursor-pointer">
                  {tr('Report a technical problem', 'Báo lỗi kỹ thuật')} <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </section>
          </div>
        )}

        {/* Feedback / technical form */}
        {isForm && (
          <div className="px-5 py-5">
            {state === 'sent' ? (
              <div className="flex flex-col items-center py-8 text-center">
                <CheckCircle2 className="h-12 w-12 text-brand" />
                <h2 className="mt-3 text-lg font-bold text-foreground">{tr('Thanks — we got it.', 'Cảm ơn — đã nhận được.')}</h2>
                <p className="mt-1.5 text-sm text-body">{tr('Our team reviews every message.', 'Đội ngũ của chúng tôi xem mọi tin nhắn.')}</p>
                <Button variant="cta" size="none" type="button" onClick={onClose} className="mt-5 rounded-xl px-5 py-2.5 text-sm transition-colors cursor-pointer">
                  {tr('Done', 'Xong')}
                </Button>
              </div>
            ) : (
              <>
                <h2 className="text-lg font-bold text-foreground">
                  {kind === 'technical' ? tr('Report a technical problem', 'Báo lỗi kỹ thuật') : tr('Send feedback', 'Gửi phản hồi')}
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-body">
                  {kind === 'technical'
                    ? tr('Tell us what went wrong and what you were doing.', 'Cho chúng tôi biết lỗi gì và bạn đang làm gì.')
                    : tr('What works well, what could be better?', 'Điều gì tốt, điều gì có thể cải thiện?')}
                </p>
                <Textarea
                  variant="outline"
                  size="compact"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={4}
                  autoFocus
                  maxLength={4000}
                  aria-label={kind === 'technical' ? tr('Describe the problem', 'Mô tả lỗi') : tr('Your feedback', 'Phản hồi của bạn')}
                  placeholder={tr('Type your message…', 'Nhập tin nhắn của bạn…')}
                  className="mt-3 border-border bg-background px-3.5 py-2.5 transition-colors focus:ring-0"
                />
                <Input
                  variant="outline"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-label={tr('Email (optional, so we can reply)', 'Email (tùy chọn, để chúng tôi trả lời)')}
                  placeholder={tr('Email (optional, so we can reply)', 'Email (tùy chọn, để chúng tôi trả lời)')}
                  className="mt-2.5 border-border bg-background px-3.5 py-2.5 transition-colors focus:ring-0"
                />
                {/* Submit-level failure: announced, not attached to a field's description. */}
                {state === 'error' && (
                  <p role="alert" className="mt-2 text-sm font-semibold text-destructive">{tr("Couldn't send — please try again.", 'Không gửi được — vui lòng thử lại.')}</p>
                )}
                <Button variant="cta" size="none"
                  type="button"
                  onClick={send}
                  disabled={message.trim().length < 2 || state === 'sending'}
                  className="mt-3 flex w-full items-center justify-center rounded-xl px-5 py-3 text-sm transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {state === 'sending' ? tr('Sending…', 'Đang gửi…') : tr('Send', 'Gửi')}
                </Button>
              </>
            )}
          </div>
        )}
        </DialogPrimitive.Popup>
      </div>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>
  )
}
