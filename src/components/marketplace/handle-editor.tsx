'use client'

import { useEffect, useRef, useState } from 'react'
import { AtSign, Check, Copy, Loader2, X } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'
import { HANDLE_RE } from '@/lib/handle-format'

// Telegram-style @handle editor — shared by the user handle (Dashboard → Settings)
// and the shop handle (business profile editor) via `target`. Live availability
// check (debounced 400ms against /api/handle/check), save via POST /api/handle
// (owner-scoped server-side — no ids travel from the client), and a copy chip for
// the shareable eno.vn/name URL (clean, no "@").

export function HandleEditor({ target, initial, label }: { target: 'profile' | 'seller'; initial: string | null; label?: string }) {
  const { tr } = useLanguage()
  const [current, setCurrent] = useState(initial)
  const [value, setValue] = useState(initial || '')
  const [state, setState] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid' | 'reserved'>('idle')
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Parent may hydrate `initial` late (cache-first dashboards).
  useEffect(() => { setCurrent(initial); setValue(initial || '') }, [initial])

  const normalized = value.trim().toLowerCase().replace(/^@/, '')
  const dirty = normalized !== (current || '')

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    setError('')
    if (!dirty) { setState('idle'); return }
    if (!HANDLE_RE.test(normalized)) { setState('invalid'); return }
    setState('checking')
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/handle/check?h=${encodeURIComponent(normalized)}`)
        const d = await r.json().catch(() => ({}))
        if (!r.ok) { setState('idle'); return }
        setState(d.available ? 'available' : d.reason === 'reserved' ? 'reserved' : d.reason === 'invalid' ? 'invalid' : 'taken')
      } catch { setState('idle') }
    }, 400)
    return () => { if (timer.current) clearTimeout(timer.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalized, dirty])

  const save = async () => {
    setSaving(true); setError('')
    try {
      const r = await fetch('/api/handle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: normalized, target }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        setError(
          d.error === 'taken' ? tr('That handle is already taken.', 'Tên này đã có người dùng.')
          : d.error === 'reserved' ? tr('That name is reserved.', 'Tên này đã được bảo lưu.')
          : d.error === 'invalid' ? tr('3–30 chars: letters, numbers, underscore; start with a letter.', '3–30 ký tự: chữ, số, gạch dưới; bắt đầu bằng chữ.')
          : d.error === 'rate_limited' ? tr('Too many changes — try again later.', 'Đổi quá nhiều lần — thử lại sau.')
          : tr('Something went wrong — try again.', 'Có lỗi xảy ra — thử lại nhé.'),
        )
        return
      }
      setCurrent(d.handle); setValue(d.handle); setState('idle')
    } catch {
      setError(tr('Something went wrong — try again.', 'Có lỗi xảy ra — thử lại nhé.'))
    } finally {
      setSaving(false)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`https://eno.vn/${current}`)
      setCopied(true); setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  const hint =
    state === 'available' ? { text: tr('Available!', 'Còn trống!'), cls: 'text-success' }
    : state === 'taken' ? { text: tr('Already taken', 'Đã có người dùng'), cls: 'text-destructive' }
    : state === 'reserved' ? { text: tr('Reserved name', 'Tên được bảo lưu'), cls: 'text-destructive' }
    : state === 'invalid' && normalized ? { text: tr('3–30 chars: a–z, 0–9, _ — start with a letter', '3–30 ký tự: a–z, 0–9, _ — bắt đầu bằng chữ'), cls: 'text-destructive' }
    : null

  return (
    <div>
      <label className="text-xs font-semibold text-muted-foreground">
        {label || tr('Public handle', 'Tên định danh công khai')}
      </label>
      <div className="mt-1 flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <AtSign className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-4" />
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={tr('your_name', 'ten_cua_ban')}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            className="w-full rounded-xl bg-tint py-2.5 pl-9 pr-9 text-sm font-semibold outline-none transition-colors focus:ring-2 focus:ring-brand/20"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2">
            {state === 'checking' && <Loader2 className="h-4 w-4 animate-spin text-ink-4" />}
            {state === 'available' && <Check className="h-4 w-4 text-success" />}
            {(state === 'taken' || state === 'reserved' || state === 'invalid') && dirty && <X className="h-4 w-4 text-destructive" />}
          </span>
        </div>
        {dirty ? (
          <button
            type="button"
            disabled={state !== 'available' || saving}
            onClick={save}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white transition-all active:scale-[0.98] cursor-pointer',
              (state !== 'available' || saving) && 'opacity-40 cursor-default',
            )}
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {tr('Save', 'Lưu')}
          </button>
        ) : current ? (
          <button
            type="button"
            onClick={copy}
            className="flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-semibold text-accent-foreground transition-colors hover:bg-muted cursor-pointer"
            aria-label={tr('Copy link', 'Sao chép liên kết')}
          >
            {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
            {copied ? tr('Copied', 'Đã chép') : tr('Copy link', 'Chép liên kết')}
          </button>
        ) : null}
      </div>
      <p className={cn('mt-1 h-4 text-xs font-semibold', hint ? hint.cls : 'text-transparent')}>{hint?.text || '—'}</p>
      {current && !dirty && (
        <p className="text-xs text-muted-foreground">eno.vn/<span className="font-semibold text-body">{current}</span></p>
      )}
      {error && <p role="alert" className="mt-1 text-xs font-semibold text-destructive">{error}</p>}
    </div>
  )
}
