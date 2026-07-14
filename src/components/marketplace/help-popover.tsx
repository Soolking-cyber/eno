'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { X, ArrowRight, ArrowLeft, CheckCircle2 } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { useFocusTrap } from '@/lib/use-focus-trap'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

type View = 'menu' | { kind: 'feedback' | 'technical' }

/** Quick Help sheet opened from the floating "?" button — a fast hub to the Help
 *  Center, reporting, and feedback (bottom-sheet on mobile, centered card on
 *  desktop). Feedback / technical reports post to /admin/feedback, not email. */
export function HelpPopover({ onClose }: { onClose: () => void }) {
  const { tr } = useLanguage()
  const [view, setView] = useState<View>('menu')
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const trapRef = useFocusTrap<HTMLDivElement>()

  // Close on Escape; lock background scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  const isForm = typeof view === 'object'
  const kind = isForm ? view.kind : 'feedback'

  const send = async () => {
    if (message.trim().length < 2 || state === 'sending') return
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
      setState(res.ok ? 'sent' : 'error')
    } catch {
      setState('error')
    }
  }

  const openForm = (k: 'feedback' | 'technical') => { setView({ kind: k }); setState('idle') }
  const backToMenu = () => { setView('menu'); setMessage(''); setEmail(''); setState('idle') }

  return (
    <div role="dialog" aria-modal="true" aria-label={tr('Help', 'Trợ giúp')} className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" aria-hidden onClick={onClose} />
      <div ref={trapRef} className="relative w-full max-h-[85vh] overflow-y-auto rounded-t-2xl bg-card shadow-overlay animate-in fade-in slide-in-from-bottom-4 duration-200 sm:max-w-md sm:rounded-2xl sm:slide-in-from-bottom-0 sm:zoom-in-95">
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
                  placeholder={tr('Type your message…', 'Nhập tin nhắn của bạn…')}
                  className="mt-3 border-border bg-background px-3.5 py-2.5 transition-colors focus:ring-0"
                />
                <Input
                  variant="outline"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={tr('Email (optional, so we can reply)', 'Email (tùy chọn, để chúng tôi trả lời)')}
                  className="mt-2.5 border-border bg-background px-3.5 py-2.5 transition-colors focus:ring-0"
                />
                {state === 'error' && (
                  <p className="mt-2 text-sm font-semibold text-destructive">{tr("Couldn't send — please try again.", 'Không gửi được — vui lòng thử lại.')}</p>
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
      </div>
    </div>
  )
}
