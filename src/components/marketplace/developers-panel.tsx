'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { KeyRound, Plus, Copy, Check, Trash2, Loader2, ShieldAlert, BookOpen } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

// Dashboard "Developers" tab (business-tier). Mint / list / revoke partner API keys via
// /api/keys. The full secret is shown ONCE at creation; afterwards only the prefix.
type ApiKey = { id: string; name: string; prefix: string; scopes: string; lastUsedAt: string | null; revokedAt: string | null; createdAt: string }

const ALL_SCOPES = ['listings:read', 'analytics:read', 'listings:write', 'media:write'] as const
const DEFAULT_SCOPES: string[] = ['listings:read', 'analytics:read'] // write is opt-in
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : null)

export function DevelopersPanel() {
  const { tr } = useLanguage()
  const [keys, setKeys] = useState<ApiKey[] | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<string[]>([...DEFAULT_SCOPES])
  const [busy, setBusy] = useState(false)
  const [secret, setSecret] = useState<string | null>(null) // freshly-minted, shown once
  const [copied, setCopied] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch('/api/keys').then((r) => (r.ok ? r.json() : { keys: [] })).then((d) => setKeys(d.keys || [])).catch(() => setKeys([]))
  }, [])
  useEffect(() => { load() }, [load])

  const toggleScope = (s: string) => setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]))

  const create = async () => {
    if (busy || scopes.length === 0) return
    setBusy(true)
    try {
      const res = await fetch('/api/keys', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() || 'API key', scopes }),
      })
      const d = await res.json().catch(() => null)
      if (res.ok && d?.key?.secret) {
        setSecret(d.key.secret); setName(''); setScopes([...DEFAULT_SCOPES]); setShowForm(false); load()
      } else {
        toast.error(d?.error === 'too_many_keys'
          ? tr('Key limit reached — revoke one first.', 'Đã đạt giới hạn khóa — hãy thu hồi bớt.')
          : tr('Could not create the key — please try again.', 'Không tạo được khóa — vui lòng thử lại.'))
      }
    } catch {
      toast.error(tr('Could not create the key — please try again.', 'Không tạo được khóa — vui lòng thử lại.'))
    } finally { setBusy(false) }
  }

  const revoke = async (id: string) => {
    setConfirmId(null)
    const res = await fetch(`/api/keys/${id}`, { method: 'DELETE' })
    if (res.ok) { load(); toast.success(tr('Key revoked.', 'Đã thu hồi khóa.')) }
    else toast.error(tr('Could not revoke the key.', 'Không thu hồi được khóa.'))
  }

  const copySecret = () => {
    if (!secret) return
    navigator.clipboard?.writeText(secret).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600) }).catch(() => {})
  }

  const active = (keys ?? []).filter((k) => !k.revokedAt)

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div>
        <h2 className="h-section text-foreground">{tr('API keys', 'Khóa API')}</h2>
        <p className="mt-1 text-sm leading-relaxed text-body">
          {tr('Manage your storefront programmatically. Authenticate requests with', 'Quản lý gian hàng bằng lập trình. Xác thực bằng')}{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-[12px] font-semibold text-foreground">Authorization: Bearer &lt;key&gt;</code>{' '}
          {tr('against the base URL', 'với base URL')}{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-[12px] font-semibold text-foreground">https://eno.vn/api/v1</code>.
        </p>
        <Link href="/developers" className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-accent-foreground hover:underline">
          <BookOpen className="h-4 w-4" /> {tr('Read the API docs', 'Xem tài liệu API')} →
        </Link>
      </div>

      {/* Freshly-minted secret — shown ONCE. */}
      {secret && (
        <div className="rounded-2xl border border-brand/40 bg-tint p-4">
          <div className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-accent-foreground" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-foreground">{tr('Copy your key now', 'Sao chép khóa ngay')}</p>
              <p className="mt-0.5 text-xs text-body">{tr("This is the only time the full key is shown. Store it somewhere safe.", 'Đây là lần duy nhất hiển thị khóa đầy đủ. Hãy lưu lại nơi an toàn.')}</p>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-card px-3 py-2 font-mono text-xs text-foreground">{secret}</code>
                <button onClick={copySecret} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-brand-dark">
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? tr('Copied', 'Đã chép') : tr('Copy', 'Chép')}
                </button>
              </div>
            </div>
          </div>
          <button onClick={() => setSecret(null)} className="mt-3 text-xs font-semibold text-ink-4 hover:text-foreground">{tr("I've saved it", 'Đã lưu')}</button>
        </div>
      )}

      {/* Create */}
      {showForm ? (
        <div className="space-y-3 rounded-2xl border border-border p-4">
          <div>
            <label className="text-xs font-bold text-foreground">{tr('Name', 'Tên')}</label>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={tr('e.g. Production server', 'VD: Máy chủ chính')}
              className="mt-1 w-full rounded-xl border border-line-strong px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" />
          </div>
          <div>
            <span className="text-xs font-bold text-foreground">{tr('Scopes', 'Phạm vi')}</span>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {ALL_SCOPES.map((s) => (
                <button key={s} onClick={() => toggleScope(s)}
                  className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                    scopes.includes(s) ? 'border-brand bg-tint text-accent-foreground' : 'border-line-strong text-muted-foreground hover:bg-muted')}>
                  {scopes.includes(s) && <Check className="mr-1 inline h-3 w-3" />}{s}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={() => { setShowForm(false); setName(''); setScopes([...DEFAULT_SCOPES]) }} className="flex-1 rounded-xl py-2.5 text-sm font-bold text-body transition-colors hover:bg-muted">{tr('Cancel', 'Hủy')}</button>
            <button onClick={create} disabled={busy || scopes.length === 0} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-bold text-white transition-colors hover:bg-brand-dark disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} {tr('Create key', 'Tạo khóa')}
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowForm(true)} className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-brand-dark">
          <Plus className="h-4 w-4" /> {tr('New API key', 'Khóa API mới')}
        </button>
      )}

      {/* List */}
      <div className="space-y-2">
        {keys === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {tr('Loading…', 'Đang tải…')}</p>
        ) : active.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-6 text-center">
            <KeyRound className="mx-auto h-6 w-6 text-ink-4" />
            <p className="mt-2 text-sm text-muted-foreground">{tr('No API keys yet.', 'Chưa có khóa API nào.')}</p>
          </div>
        ) : (
          active.map((k) => (
            <div key={k.id} className="flex items-center gap-3 rounded-2xl border border-border p-3.5">
              <KeyRound className="h-5 w-5 shrink-0 text-accent-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="truncate text-sm font-bold text-foreground">{k.name}</span>
                  <code className="font-mono text-[11px] text-muted-foreground">{k.prefix}…</code>
                </div>
                <p className="mt-0.5 text-[11px] text-ink-4">
                  {k.scopes.split(/\s+/).join(' · ')} · {tr('created', 'tạo')} {fmtDate(k.createdAt)}
                  {k.lastUsedAt ? ` · ${tr('last used', 'dùng gần nhất')} ${fmtDate(k.lastUsedAt)}` : ` · ${tr('never used', 'chưa dùng')}`}
                </p>
              </div>
              {confirmId === k.id ? (
                <div className="flex shrink-0 items-center gap-1.5">
                  <button onClick={() => revoke(k.id)} className="rounded-full bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700">{tr('Revoke', 'Thu hồi')}</button>
                  <button onClick={() => setConfirmId(null)} className="rounded-full px-2 py-1.5 text-xs font-semibold text-ink-4 hover:text-foreground">{tr('Cancel', 'Hủy')}</button>
                </div>
              ) : (
                <button onClick={() => setConfirmId(k.id)} aria-label={tr('Revoke', 'Thu hồi')} title={tr('Revoke', 'Thu hồi')}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-4 transition-colors hover:bg-muted hover:text-red-600">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
