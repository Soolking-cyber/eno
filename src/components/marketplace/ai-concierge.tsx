'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Sparkles, X, ArrowUp, Loader2 } from 'lucide-react'
import { ListingCard } from './listing-card'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'
import type { SerializedListing } from '@/lib/types'

/** The pressable AI icon that sits left of the camera in every search bar. It's a
 *  STATE button, not a toggle switch: press → active (filled background), press again
 *  → back to normal search. Style mirrors the old location pin's active state. */
export function AISearchButton({
  active, onClick, className, iconClassName = 'h-6 w-6',
}: { active: boolean; onClick: () => void; className?: string; iconClassName?: string }) {
  const { tr } = useLanguage()
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={tr('AI shopping assistant', 'Trợ lý mua sắm AI')}
      title={tr('Ask eno AI', 'Hỏi eno AI')}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-xl transition-all active:scale-95 tap-44 relative',
        active ? 'bg-primary text-white shadow-sm' : 'text-body hover:bg-muted',
        className,
      )}
    >
      <Sparkles className={iconClassName} />
    </button>
  )
}

type Msg = { role: 'user' | 'assistant'; content: string; listings?: SerializedListing[] }

/** The Alibaba-style AI conversation window. Opens when AI mode is active; the buyer
 *  describes what they want and gets a reply + product cards in the chat. */
export function AIConciergePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const { tr, lang } = useLanguage()
  const [mounted, setMounted] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => setMounted(true), [])

  // Seed the greeting the first time it opens; focus the input.
  useEffect(() => {
    if (!open) return
    setMessages((m) => m.length ? m : [{
      role: 'assistant',
      content: tr(
        "Hi! Tell me what you're looking for — e.g. “a road bike under 8M near Thảo Điền” — and I'll find it.",
        'Chào bạn! Bạn đang tìm gì? Ví dụ "xe đạp dưới 8 triệu gần Thảo Điền" — mình sẽ tìm giúp.',
      ),
    }])
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [open, tr])

  // Keep the latest message in view.
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }) }, [messages, loading])

  // Esc closes; lock body scroll while open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [open, onClose])

  async function send(text: string) {
    const q = text.trim()
    if (!q || loading) return
    const next: Msg[] = [...messages, { role: 'user', content: q }]
    setMessages(next)
    setInput('')
    setLoading(true)
    try {
      const res = await fetch('/api/ai/concierge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lang, messages: next.map((m) => ({ role: m.role, content: m.content })) }),
      })
      const d = await res.json()
      setMessages((m) => [...m, { role: 'assistant', content: d.reply || tr('Here are some options:', 'Đây là vài lựa chọn:'), listings: d.listings || [] }])
    } catch {
      setMessages((m) => [...m, { role: 'assistant', content: tr('Something went wrong — please try again.', 'Đã có lỗi — vui lòng thử lại.') }])
    } finally {
      setLoading(false)
    }
  }

  if (!mounted || !open) return null

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-stretch justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px] animate-in fade-in duration-150" onClick={onClose} />
      <div className="relative z-10 flex h-full w-full flex-col bg-card shadow-pop animate-in fade-in slide-in-from-bottom-2 duration-150 sm:h-[min(640px,90vh)] sm:max-w-lg sm:rounded-2xl">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-white"><Sparkles className="h-5 w-5" /></span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-foreground leading-tight">{tr('eno AI', 'eno AI')}</p>
            <p className="text-[11px] text-muted-foreground leading-tight">{tr('Describe it, I’ll find it', 'Mô tả đi, mình tìm cho')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={tr('Close', 'Đóng')} className="ml-auto flex h-9 w-9 items-center justify-center rounded-full text-ink-4 hover:bg-muted hover:text-foreground tap-44">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4 scroll-thin">
          {messages.map((m, i) => (
            <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div className={cn('max-w-[85%] space-y-2', m.role === 'user' && 'order-2')}>
                <div className={cn(
                  'rounded-2xl px-3.5 py-2 text-sm leading-relaxed',
                  m.role === 'user' ? 'bg-primary text-white rounded-br-sm' : 'bg-muted text-foreground rounded-bl-sm',
                )}>
                  {m.content}
                </div>
                {m.listings && m.listings.length > 0 && (
                  <div className="grid grid-cols-2 gap-2">
                    {m.listings.map((l) => (
                      <ListingCard key={l.id} listing={l} onOpen={(x) => { onClose(); router.push(`/listings/${x.id}`) }} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm bg-muted px-3.5 py-2.5 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> {tr('Searching…', 'Đang tìm…')}
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <form
          onSubmit={(e) => { e.preventDefault(); send(input) }}
          className="flex items-center gap-2 border-t border-border p-3"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={tr('Ask for anything…', 'Hỏi bất cứ điều gì…')}
            enterKeyHint="send"
            className="min-w-0 flex-1 rounded-xl bg-tint px-4 py-3 text-base text-foreground outline-none placeholder:text-ink-4 focus:ring-2 focus:ring-ring/30"
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            aria-label={tr('Send', 'Gửi')}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-white transition-all active:scale-95 disabled:opacity-40 tap-44"
          >
            <ArrowUp className="h-5 w-5" />
          </button>
        </form>
      </div>
    </div>,
    document.body,
  )
}
