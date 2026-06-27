'use client'

import { useState } from 'react'
import { CheckCircle2, MessageSquareText, Wrench } from 'lucide-react'
import { useLanguage } from '@/context/language-context'

/** In-app feedback / technical-problem form for the Help Center. Posts to
 *  /api/feedback → the /admin/feedback queue (so mobile, which has no "?" popup,
 *  still has a path to send feedback to the team). */
export function HelpFeedback() {
  const { tr } = useLanguage()
  const [kind, setKind] = useState<'feedback' | 'technical'>('feedback')
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

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

  if (state === 'sent') {
    return (
      <div className="flex items-center gap-3 rounded-2xl bg-[#e8f1fb] px-4 py-4 text-sm font-semibold text-[#0a66c2]">
        <CheckCircle2 className="h-5 w-5 shrink-0" />
        {tr('Thanks — we got your message. Our team reviews every one.', 'Cảm ơn — chúng tôi đã nhận tin nhắn. Đội ngũ sẽ xem từng phản hồi.')}
      </div>
    )
  }

  const Toggle = ({ value, label, Icon }: { value: 'feedback' | 'technical'; label: string; Icon: typeof Wrench }) => (
    <button
      type="button"
      onClick={() => setKind(value)}
      className={
        'inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-semibold transition-colors cursor-pointer ' +
        (kind === value ? 'bg-[#0a66c2] text-white' : 'text-body hover:bg-muted')
      }
    >
      <Icon className="h-4 w-4" /> {label}
    </button>
  )

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <Toggle value="feedback" label={tr('Send feedback', 'Gửi phản hồi')} Icon={MessageSquareText} />
        <Toggle value="technical" label={tr('Technical problem', 'Lỗi kỹ thuật')} Icon={Wrench} />
      </div>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={4}
        maxLength={4000}
        placeholder={kind === 'technical' ? tr('What went wrong, and what were you doing?', 'Lỗi gì, và bạn đang làm gì?') : tr('What works well, what could be better?', 'Điều gì tốt, điều gì có thể cải thiện?')}
        className="mt-3 w-full resize-none rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-[#0a66c2]"
      />
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={tr('Email (optional, so we can reply)', 'Email (tùy chọn, để chúng tôi trả lời)')}
        className="mt-2.5 w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-[#0a66c2]"
      />
      {state === 'error' && (
        <p className="mt-2 text-sm font-semibold text-destructive">{tr("Couldn't send — please try again.", 'Không gửi được — vui lòng thử lại.')}</p>
      )}
      <button
        type="button"
        onClick={send}
        disabled={message.trim().length < 2 || state === 'sending'}
        className="mt-3 inline-flex items-center justify-center rounded-xl bg-[#0a66c2] px-6 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#004182] disabled:opacity-50 cursor-pointer"
      >
        {state === 'sending' ? tr('Sending…', 'Đang gửi…') : tr('Send', 'Gửi')}
      </button>
    </div>
  )
}
