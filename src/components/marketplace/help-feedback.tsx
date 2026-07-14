'use client'

import { useState } from 'react'
import { CheckCircle2, MessageSquareText, Wrench } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

// Hoisted to module scope so it keeps a stable component identity across the parent's
// re-renders — a component created inside render remounts its subtree on every keystroke.
//
// `active` used to be spent ENTIRELY on className: the selected toggle was blue and reported
// nothing, so a screen reader heard two identical buttons and could not tell which kind of message
// it was about to send. aria-pressed puts the state in the accessibility tree. (aria-pressed, not
// role="radio": these two are a pair of toggle buttons, and the group is titled by the form around
// them — there is no separate radiogroup label to hang.)
function Toggle({ label, Icon, active, onSelect }: { label: string; Icon: typeof Wrench; active: boolean; onSelect: () => void }) {
  return (
    <Button
      variant="bare"
      size="none"
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={
        'gap-1.5 rounded-xl px-3 py-1.5 text-sm font-semibold transition-colors cursor-pointer ' +
        (active ? 'bg-primary text-white' : 'text-body hover:bg-muted')
      }
    >
      <Icon className="h-4 w-4" /> {label}
    </Button>
  )
}

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
      <div className="flex items-center gap-3 rounded-2xl bg-brand-50 px-4 py-4 text-sm font-semibold text-brand">
        <CheckCircle2 className="h-5 w-5 shrink-0" />
        {tr('Thanks — we got your message. Our team reviews every one.', 'Cảm ơn — chúng tôi đã nhận tin nhắn. Đội ngũ sẽ xem từng phản hồi.')}
      </div>
    )
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <Toggle label={tr('Send feedback', 'Gửi phản hồi')} Icon={MessageSquareText} active={kind === 'feedback'} onSelect={() => setKind('feedback')} />
        <Toggle label={tr('Technical problem', 'Lỗi kỹ thuật')} Icon={Wrench} active={kind === 'technical'} onSelect={() => setKind('technical')} />
      </div>
      <Textarea
        variant="outline"
        size="compact"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={4}
        maxLength={4000}
        aria-label={kind === 'technical' ? tr('Describe the problem', 'Mô tả lỗi') : tr('Your feedback', 'Phản hồi của bạn')}
        placeholder={kind === 'technical' ? tr('What went wrong, and what were you doing?', 'Lỗi gì, và bạn đang làm gì?') : tr('What works well, what could be better?', 'Điều gì tốt, điều gì có thể cải thiện?')}
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
      {/* Submit-level failure: it belongs to the whole send, not to the message or the
          email field, so it is ANNOUNCED (role="alert") — never aria-describedby. */}
      {state === 'error' && (
        <p role="alert" className="mt-2 text-sm font-semibold text-destructive">{tr("Couldn't send — please try again.", 'Không gửi được — vui lòng thử lại.')}</p>
      )}
      <Button variant="cta" size="none"
        type="button"
        onClick={send}
        disabled={message.trim().length < 2 || state === 'sending'}
        className="mt-3 inline-flex items-center justify-center rounded-xl px-6 py-2.5 text-sm transition-colors disabled:opacity-50 cursor-pointer"
      >
        {state === 'sending' ? tr('Sending…', 'Đang gửi…') : tr('Send', 'Gửi')}
      </Button>
    </div>
  )
}
