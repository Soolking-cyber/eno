'use client'

import { useEffect, useRef, useState } from 'react'
import { AtSign, Check, Copy, Loader2, X } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Field, FieldControl, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { HANDLE_RE } from '@/lib/handle-format'
import { useLatestRequest } from '@/hooks/use-latest-request'

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
  const latest = useLatestRequest()

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
    // Stale-async guard (audit Phase 2): type 'ab' (fetch fires) → 'abc' (returns
    // first) → the slow 'ab' response would set 'available' for a value the input no
    // longer holds, and Save is gated ONLY on that state — a wrong-handle save path.
    const req = latest.begin()
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/handle/check?h=${encodeURIComponent(normalized)}`, { signal: req.signal })
        const d = await r.json().catch(() => ({}))
        if (!req.isCurrent()) return
        if (!r.ok) { setState('idle'); return }
        setState(d.available ? 'available' : d.reason === 'reserved' ? 'reserved' : d.reason === 'invalid' ? 'invalid' : 'taken')
      } catch { if (req.isCurrent()) setState('idle') }
    }, 400)
    return () => { if (timer.current) clearTimeout(timer.current) }
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

  // The verdict of the live check, split by KIND — because the two kinds are different a11y objects.
  // A failure is a property of the field: it makes the control aria-invalid and becomes its description
  // (<FieldError>). "Available!" is the opposite of an error, so it cannot ride in a <FieldError> at all
  // — it stays a <FieldDescription>. Both render inside one polite live region so that a screen-reader
  // user, who is mid-typing and never changes focus, actually HEARS the verdict instead of just finding
  // Save mysteriously disabled.
  const hint: { kind: 'error' | 'ok'; text: string } | null =
    state === 'available' ? { kind: 'ok', text: tr('Available!', 'Còn trống!') }
    : state === 'taken' ? { kind: 'error', text: tr('Already taken', 'Đã có người dùng') }
    : state === 'reserved' ? { kind: 'error', text: tr('Reserved name', 'Tên được bảo lưu') }
    : state === 'invalid' && normalized ? { kind: 'error', text: tr('3–30 chars: a–z, 0–9, _ — start with a letter', '3–30 ký tự: a–z, 0–9, _ — bắt đầu bằng chữ') }
    : null

  return (
    // gap-0: this layout already spaces itself with mt-* on each row, so Field's default gap would
    // add a second helping. Field is here for the WIRING (aria-invalid + a merged aria-describedby),
    // not for the spacing.
    <Field invalid={hint?.kind === 'error'} className="gap-0">
      <FieldLabel render={<Label />} className="block text-xs font-semibold leading-normal text-muted-foreground">
        {label || tr('Public handle', 'Tên định danh công khai')}
      </FieldLabel>
      <div className="mt-1 flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <AtSign className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-4" />
          <FieldControl
            id={`handle-${target}`}
            render={
              <Input
                id={`handle-${target}`}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={tr('your_name', 'ten_cua_ban')}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                variant="filled"
                className="py-2.5 pl-9 pr-9 font-semibold transition-colors focus:ring-brand/20"
              />
            }
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2">
            {state === 'checking' && <Loader2 className="h-4 w-4 animate-spin text-ink-4" />}
            {state === 'available' && <Check className="h-4 w-4 text-success" />}
            {(state === 'taken' || state === 'reserved' || state === 'invalid') && dirty && <X className="h-4 w-4 text-destructive" />}
          </span>
        </div>
        {dirty ? (
          <Button
            type="button"
            variant="cta"
            size="none"
            disabled={state !== 'available' || saving}
            onClick={save}
            className="shrink-0 gap-1.5 px-4 py-2.5 cursor-pointer active:scale-[0.98] disabled:opacity-40 disabled:cursor-default"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {tr('Save', 'Lưu')}
          </Button>
        ) : current ? (
          <Button
            type="button"
            variant="soft"
            size="none"
            onClick={copy}
            className="shrink-0 gap-1.5 px-3 py-2.5 font-semibold text-accent-foreground cursor-pointer"
            aria-label={tr('Copy link', 'Sao chép liên kết')}
          >
            {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
            {copied ? tr('Copied', 'Đã chép') : tr('Copy link', 'Chép liên kết')}
          </Button>
        ) : null}
      </div>
      {/* h-4 is LOAD-BEARING: the slot keeps its height whether or not there is a verdict, so the row
          below does not jump on every keystroke (it used to hold a transparent em-dash for exactly this
          reason). aria-live="polite" — never "assertive"/role="alert" — so the verdict is spoken between
          keystrokes instead of interrupting the letter the user is typing. */}
      <div aria-live="polite" className="mt-1 h-4">
        {hint?.kind === 'error' && <FieldError className="font-semibold">{hint.text}</FieldError>}
        {hint?.kind === 'ok' && <FieldDescription className="font-semibold text-success">{hint.text}</FieldDescription>}
      </div>
      {current && !dirty && (
        <p className="text-xs text-muted-foreground">eno.vn/<span className="font-semibold text-body">{current}</span></p>
      )}
      {/* Save failed — a verdict on the ATTEMPT (incl. rate limits), so it is announced, not described. */}
      {error && <p role="alert" className="mt-1 text-xs font-semibold text-destructive">{error}</p>}
    </Field>
  )
}
