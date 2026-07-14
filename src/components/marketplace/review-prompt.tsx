'use client'

import { useState } from 'react'
import { X, Star, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { useLanguage } from '@/context/language-context'
import { haptic } from '@/lib/haptics'

/**
 * Post-transaction review prompt for the BUYER, shared by the full thread page
 * and the docked chat widget. A single quiet inline card (never a modal) shown
 * above the composer once the deal closed (listing sold / offer accepted) and
 * only until this conversation has a review: pick a star → an optional one-line
 * note appears → Submit POSTs to /api/sellers/[id]/reviews (which re-verifies
 * everything server-side). Success collapses to a one-line thanks. The ✕ hides
 * it for the session only (component state) — it quietly returns next visit
 * until reviewed.
 */
export function ReviewPrompt({
  sellerId,
  sellerName,
  conversationId,
  className,
}: {
  sellerId: string
  sellerName: string
  conversationId: string
  className?: string
}) {
  const { tr } = useLanguage()
  const [state, setState] = useState<'ask' | 'sending' | 'done' | 'dismissed'>('ask')
  const [rating, setRating] = useState(0)
  const [text, setText] = useState('')

  if (state === 'dismissed') return null

  if (state === 'done') {
    return (
      <div className={className}>
        <p className="rounded-2xl bg-success/10 px-3 py-2 text-xs font-medium text-success duration-200 animate-in fade-in">
          <span aria-hidden>{'★'.repeat(rating || 5)}</span>{' '}
          {tr("Thanks — your review is live on the seller's page", 'Cảm ơn — đánh giá của bạn đã hiển thị trên trang người bán')}
        </p>
      </div>
    )
  }

  const submit = async () => {
    if (!rating || state === 'sending') return
    setState('sending')
    haptic()
    try {
      const res = await fetch(`/api/sellers/${sellerId}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, rating, text: text.trim() || undefined }),
      })
      if (res.ok) { setState('done'); return }
      const err = (await res.json().catch(() => null))?.error
      if (err === 'already_reviewed') { setState('done'); return } // someone double-tapped — it's in
      setState('ask')
      toast.error(
        err === 'rate_limited'
          ? tr('Too many requests — please try again shortly.', 'Quá nhiều yêu cầu — vui lòng thử lại sau.')
          : tr('Could not submit your review — please try again.', 'Chưa gửi được đánh giá — vui lòng thử lại.'),
      )
    } catch {
      setState('ask')
      toast.error(tr('Could not submit your review — please try again.', 'Chưa gửi được đánh giá — vui lòng thử lại.'))
    }
  }

  return (
    <div className={className}>
      <div className="rounded-2xl bg-tint px-3 py-2.5 duration-200 animate-in fade-in">
        <div className="flex items-start gap-1.5">
          <p className="min-w-0 flex-1 text-xs font-medium text-foreground">
            {tr('How was your experience with {seller}?', 'Trải nghiệm của bạn với {seller} thế nào?').replace('{seller}', sellerName)}
          </p>
          <IconButton
            size="xs"
            onClick={() => setState('dismissed')}
            aria-label={tr('Dismiss', 'Đóng')}
            className="h-auto w-auto p-1 text-ink-4 transition-colors hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </IconButton>
        </div>
        <div className="mt-0.5 flex items-center">
          {[1, 2, 3, 4, 5].map((n) => (
            <IconButton
              key={n}
              size="md"
              onClick={() => setRating(n)}
              aria-label={tr('{n} stars', '{n} sao').replace('{n}', String(n))}
            >
              <Star className={`h-5 w-5 transition-colors ${n <= rating ? 'fill-warning text-warning' : 'text-ink-4'}`} />
            </IconButton>
          ))}
        </div>
        {rating > 0 && (
          <div className="mt-1.5 flex items-center gap-2 duration-200 animate-in fade-in">
            <Input
              variant="outline"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
              maxLength={600}
              placeholder={tr('Anything to add? (optional)', 'Bạn muốn chia sẻ thêm? (không bắt buộc)')}
              className="w-auto min-w-0 flex-1 px-3 py-2 text-xs focus:ring-brand/20"
            />
            <Button
              variant="cta"
              size="none"
              onClick={submit}
              disabled={state === 'sending'}
              className="relative tap-44 rounded-full px-3 py-2 text-xs font-bold"
            >
              {state === 'sending' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : tr('Submit', 'Gửi đánh giá')}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
