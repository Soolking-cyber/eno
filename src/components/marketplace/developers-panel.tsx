'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { KeyRound, Plus, Copy, Check, Trash2, Loader2, ShieldAlert, BookOpen, Webhook, Bot, Pause, Play, AlertTriangle } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// Dashboard "Developers" tab (business-tier). Mint / list / revoke partner API keys via
// /api/keys. The full secret is shown ONCE at creation; afterwards only the prefix.
type ApiKey = { id: string; name: string; prefix: string; scopes: string; lastUsedAt: string | null; revokedAt: string | null; createdAt: string }
type WebhookHook = { id: string; url: string; events: string[]; enabled: boolean; failureCount: number; lastError: string | null; lastDeliveryAt: string | null; createdAt: string }

const WEBHOOK_EVENTS = ['listing.created', 'listing.updated', 'listing.status_changed', 'listing.deleted'] as const
const MCP_ENDPOINT = 'https://eno.vn/api/mcp'

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
        body: JSON.stringify({ name: name.trim(), scopes }),
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
    if (res.ok) load()
    else toast.error(tr('Could not revoke the key.', 'Không thu hồi được khóa.'))
  }

  const copySecret = () => {
    if (!secret) return
    navigator.clipboard?.writeText(secret).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600) }).catch(() => {})
  }

  const active = (keys ?? []).filter((k) => !k.revokedAt)

  return (
    // One column at every width. The two-column split was written for the old
    // full-page dashboard, where a single column read sparse; this panel now lives
    // in the 440px account rail, where two columns squeeze each to ~200px. Same
    // fix (and same reason) as the disputes list. (user-picked 2026-07-14)
    <div className="w-full">
      {/* API keys + Webhooks */}
      <div className="space-y-6">
      <div>
        <h2 className="h-section text-foreground">{tr('API keys', 'Khóa API')}</h2>
        <p className="mt-1 text-sm leading-relaxed text-body">
          {tr('Manage your storefront programmatically. Authenticate requests with', 'Quản lý gian hàng bằng lập trình. Xác thực bằng')}{' '}
          <code className="rounded-lg bg-muted px-1 py-0.5 text-xs font-semibold text-foreground">Authorization: Bearer &lt;key&gt;</code>{' '}
          {tr('against the base URL', 'với base URL')}{' '}
          <code className="rounded-lg bg-muted px-1 py-0.5 text-xs font-semibold text-foreground">https://eno.vn/api/v1</code>.
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
                <Button variant="cta" size="none" onClick={copySecret} className="shrink-0 gap-1.5 rounded-lg px-3 py-2 text-xs">
                  {copied ? <Check className="size-4" /> : <Copy className="h-3.5 w-3.5" />} {copied ? tr('Copied', 'Đã chép') : tr('Copy', 'Chép')}
                </Button>
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
            <Label htmlFor="api-key-name" className="text-xs font-bold text-foreground">{tr('Name', 'Tên')}</Label>
            <Input id="api-key-name" variant="outline" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={tr('e.g. Production server', 'VD: Máy chủ chính')}
              className="mt-1 px-3 py-2" />
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
            <Button variant="cta" size="none" onClick={create} disabled={busy || scopes.length === 0} className="flex-1 py-2.5">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} {tr('Create key', 'Tạo khóa')}
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="cta" size="none" onClick={() => setShowForm(true)} className="px-4 py-2.5">
          <Plus className="h-4 w-4" /> {tr('New API key', 'Khóa API mới')}
        </Button>
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
                  <span className="truncate text-sm font-bold text-foreground">{k.name || tr('Untitled key', 'Khóa chưa đặt tên')}</span>
                  <code className="font-mono text-2xs text-muted-foreground">{k.prefix}…</code>
                </div>
                <p className="mt-0.5 text-2xs text-ink-4">
                  {k.scopes.split(/\s+/).join(' · ')} · {tr('created', 'tạo')} {fmtDate(k.createdAt)}
                  {k.lastUsedAt ? ` · ${tr('last used', 'dùng gần nhất')} ${fmtDate(k.lastUsedAt)}` : ` · ${tr('never used', 'chưa dùng')}`}
                </p>
              </div>
              {confirmId === k.id ? (
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button variant="destructive" size="none" onClick={() => revoke(k.id)} className="cursor-pointer rounded-full px-3 py-1.5 text-xs font-bold">{tr('Revoke', 'Thu hồi')}</Button>
                  <Button variant="ghost" size="none" onClick={() => setConfirmId(null)} className="cursor-pointer rounded-full px-2 py-1.5 text-xs font-semibold text-ink-4 hover:bg-transparent hover:text-foreground">{tr('Cancel', 'Hủy')}</Button>
                </div>
              ) : (
                <IconButton size="sm" onClick={() => setConfirmId(k.id)} aria-label={tr('Revoke', 'Thu hồi')} title={tr('Revoke', 'Thu hồi')}
                  className="text-ink-4 transition-colors hover:bg-muted hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
                </IconButton>
              )}
            </div>
          ))
        )}
      </div>

      <div className="border-t border-border pt-6"><WebhooksSection /></div>
      </div>
      {/* MCP server — below the keys, separated by a plain rule (one column now). */}
      <div className="mt-6 border-t border-border pt-6">
        <McpSection />
      </div>
    </div>
  )
}

// ── Webhooks ─────────────────────────────────────────────────────────────────────
// Register HTTPS endpoints that receive signed listing events. Mirrors the API-key flow:
// the signing secret is shown ONCE on creation. Backed by session-authed /api/webhooks.
function WebhooksSection() {
  const { tr } = useLanguage()
  const [hooks, setHooks] = useState<WebhookHook[] | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState<string[]>([]) // empty = all events ("*")
  const [busy, setBusy] = useState(false)
  const [secret, setSecret] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch('/api/webhooks').then((r) => (r.ok ? r.json() : { webhooks: [] })).then((d) => setHooks(d.webhooks || [])).catch(() => setHooks([]))
  }, [])
  useEffect(() => { load() }, [load])

  const toggleEvent = (e: string) => setEvents((cur) => (cur.includes(e) ? cur.filter((x) => x !== e) : [...cur, e]))

  const create = async () => {
    if (busy || !url.trim()) return
    setBusy(true)
    try {
      const res = await fetch('/api/webhooks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), events: events.length ? events : '*' }),
      })
      const d = await res.json().catch(() => null)
      if (res.ok && d?.webhook?.secret) {
        setSecret(d.webhook.secret); setUrl(''); setEvents([]); setShowForm(false); load()
      } else {
        const code = d?.error
        toast.error(
          code === 'unsafe_url' ? tr('Use a public HTTPS URL.', 'Hãy dùng URL HTTPS công khai.')
          : code === 'too_many_webhooks' ? tr('Webhook limit reached — remove one first.', 'Đã đạt giới hạn webhook — hãy xóa bớt.')
          : tr('Could not add the webhook — please try again.', 'Không thêm được webhook — vui lòng thử lại.'))
      }
    } catch {
      toast.error(tr('Could not add the webhook — please try again.', 'Không thêm được webhook — vui lòng thử lại.'))
    } finally { setBusy(false) }
  }

  const remove = async (id: string) => {
    setConfirmId(null)
    const res = await fetch(`/api/webhooks/${id}`, { method: 'DELETE' })
    if (res.ok) load()
    else toast.error(tr('Could not remove the webhook.', 'Không xóa được webhook.'))
  }

  const toggleEnabled = async (h: WebhookHook) => {
    setHooks((cur) => cur?.map((x) => (x.id === h.id ? { ...x, enabled: !x.enabled } : x)) ?? null) // optimistic
    const res = await fetch(`/api/webhooks/${h.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !h.enabled }),
    })
    if (!res.ok) { load(); toast.error(tr('Could not update the webhook.', 'Không cập nhật được webhook.')) } else load()
  }

  const copySecret = () => {
    if (!secret) return
    navigator.clipboard?.writeText(secret).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600) }).catch(() => {})
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="h-section flex items-center gap-2 text-foreground"><Webhook className="h-5 w-5 text-accent-foreground" /> {tr('Webhooks', 'Webhook')}</h2>
        <p className="mt-1 text-sm leading-relaxed text-body">
          {tr('Get a signed POST to your server the moment a listing changes. Verify each delivery with the',
              'Nhận POST đã ký tới máy chủ của bạn ngay khi tin đăng thay đổi. Xác minh mỗi lần gửi bằng header')}{' '}
          <code className="rounded-lg bg-muted px-1 py-0.5 text-xs font-semibold text-foreground">webhook-signature</code> {tr('header.', '.')}
        </p>
      </div>

      {/* Freshly-minted signing secret — shown ONCE. */}
      {secret && (
        <div className="rounded-2xl border border-brand/40 bg-tint p-4">
          <div className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-accent-foreground" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-foreground">{tr('Copy your signing secret now', 'Sao chép khóa ký ngay')}</p>
              <p className="mt-0.5 text-xs text-body">{tr('This is the only time it is shown. Use it to verify the signature on every delivery.', 'Đây là lần duy nhất hiển thị. Dùng nó để xác minh chữ ký trên mỗi lần gửi.')}</p>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-card px-3 py-2 font-mono text-xs text-foreground">{secret}</code>
                <Button variant="cta" size="none" onClick={copySecret} className="shrink-0 gap-1.5 rounded-lg px-3 py-2 text-xs">
                  {copied ? <Check className="size-4" /> : <Copy className="h-3.5 w-3.5" />} {copied ? tr('Copied', 'Đã chép') : tr('Copy', 'Chép')}
                </Button>
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
            <Label htmlFor="webhook-url" className="text-xs font-bold text-foreground">{tr('Endpoint URL', 'URL điểm cuối')}</Label>
            <Input id="webhook-url" variant="outline" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.your-shop.com/eno-webhook" inputMode="url"
              className="mt-1 px-3 py-2 font-mono" />
          </div>
          <div>
            <span className="text-xs font-bold text-foreground">{tr('Events', 'Sự kiện')}</span>
            <p className="text-2xs text-ink-4">{tr('None selected = all events.', 'Không chọn = tất cả sự kiện.')}</p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {WEBHOOK_EVENTS.map((e) => (
                <button key={e} onClick={() => toggleEvent(e)}
                  className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                    events.includes(e) ? 'border-brand bg-tint text-accent-foreground' : 'border-line-strong text-muted-foreground hover:bg-muted')}>
                  {events.includes(e) && <Check className="mr-1 inline h-3 w-3" />}{e}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={() => { setShowForm(false); setUrl(''); setEvents([]) }} className="flex-1 rounded-xl py-2.5 text-sm font-bold text-body transition-colors hover:bg-muted">{tr('Cancel', 'Hủy')}</button>
            <Button variant="cta" size="none" onClick={create} disabled={busy || !url.trim()} className="flex-1 py-2.5">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} {tr('Add webhook', 'Thêm webhook')}
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="cta" size="none" onClick={() => setShowForm(true)} className="px-4 py-2.5">
          <Plus className="h-4 w-4" /> {tr('Add webhook', 'Thêm webhook')}
        </Button>
      )}

      {/* List */}
      <div className="space-y-2">
        {hooks === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {tr('Loading…', 'Đang tải…')}</p>
        ) : hooks.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-6 text-center">
            <Webhook className="mx-auto h-6 w-6 text-ink-4" />
            <p className="mt-2 text-sm text-muted-foreground">{tr('No webhooks yet.', 'Chưa có webhook nào.')}</p>
          </div>
        ) : (
          hooks.map((h) => (
            <div key={h.id} className="flex items-center gap-3 rounded-2xl border border-border p-3.5">
              <Webhook className={cn('h-5 w-5 shrink-0', h.enabled ? 'text-accent-foreground' : 'text-ink-4')} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="truncate font-mono text-sm font-bold text-foreground">{h.url}</span>
                  {!h.enabled && <span className="rounded-full bg-muted px-2 py-0.5 text-3xs font-bold uppercase tracking-wide text-ink-4">{tr('Paused', 'Tạm dừng')}</span>}
                </div>
                <p className="mt-0.5 text-2xs text-ink-4">
                  {h.events.includes('*') ? tr('all events', 'tất cả sự kiện') : h.events.join(' · ')}
                </p>
                {h.failureCount > 0 && (
                  <p className="mt-0.5 flex items-center gap-1 text-2xs text-destructive">
                    <AlertTriangle className="h-3 w-3 shrink-0" /> {tr('Recent failures:', 'Lỗi gần đây:')} {h.failureCount}
                  </p>
                )}
              </div>
              {confirmId === h.id ? (
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button variant="destructive" size="none" onClick={() => remove(h.id)} className="cursor-pointer rounded-full px-3 py-1.5 text-xs font-bold">{tr('Remove', 'Xóa')}</Button>
                  <Button variant="ghost" size="none" onClick={() => setConfirmId(null)} className="cursor-pointer rounded-full px-2 py-1.5 text-xs font-semibold text-ink-4 hover:bg-transparent hover:text-foreground">{tr('Cancel', 'Hủy')}</Button>
                </div>
              ) : (
                <div className="flex shrink-0 items-center gap-0.5">
                  <button onClick={() => toggleEnabled(h)} aria-label={h.enabled ? tr('Pause', 'Tạm dừng') : tr('Resume', 'Tiếp tục')} title={h.enabled ? tr('Pause', 'Tạm dừng') : tr('Resume', 'Tiếp tục')}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-ink-4 transition-colors hover:bg-muted hover:text-foreground">
                    {h.enabled ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </button>
                  <button onClick={() => setConfirmId(h.id)} aria-label={tr('Remove', 'Xóa')} title={tr('Remove', 'Xóa')}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-ink-4 transition-colors hover:bg-muted hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ── MCP server ───────────────────────────────────────────────────────────────────
// Read-only connection guide: point an AI assistant at the live MCP endpoint, authenticating
// with one of the API keys above. No new backend — /api/mcp already exists.
function McpSection() {
  const { tr } = useLanguage()
  const [copied, setCopied] = useState<string | null>(null)
  const copy = (text: string, id: string) => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(id); setTimeout(() => setCopied(null), 1600) }).catch(() => {})
  }
  const config = JSON.stringify({ mcpServers: { eno: { url: MCP_ENDPOINT, headers: { Authorization: 'Bearer eno_live_…' } } } }, null, 2)

  return (
    <div className="space-y-4">
      <div>
        <h2 className="h-section flex items-center gap-2 text-foreground"><Bot className="h-5 w-5 text-accent-foreground" /> {tr('MCP server', 'Máy chủ MCP')}</h2>
        <p className="mt-1 text-sm leading-relaxed text-body">
          {tr('Connect an AI assistant (Claude and others) to run your shop in plain language — list, create, update, bulk-import, sync a catalogue, and read analytics. The assistant only ever sees tool results, never your key.',
              'Kết nối trợ lý AI (Claude và các trợ lý khác) để quản lý gian hàng bằng ngôn ngữ tự nhiên — đăng, tạo, cập nhật, nhập hàng loạt, đồng bộ danh mục và xem phân tích. Trợ lý chỉ thấy kết quả công cụ, không bao giờ thấy khóa của bạn.')}
        </p>
      </div>

      <div className="space-y-3 rounded-2xl border border-border p-4">
        <div>
          <span className="text-xs font-bold text-foreground">{tr('Endpoint', 'Điểm cuối')}</span>
          <div className="mt-1 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-muted px-3 py-2 font-mono text-xs text-foreground">{MCP_ENDPOINT}</code>
            <button onClick={() => copy(MCP_ENDPOINT, 'url')} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line-strong px-3 py-2 text-xs font-bold text-foreground transition-colors hover:bg-muted">
              {copied === 'url' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied === 'url' ? tr('Copied', 'Đã chép') : tr('Copy', 'Chép')}
            </button>
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-foreground">{tr('Client config', 'Cấu hình ứng dụng')}</span>
            <button onClick={() => copy(config, 'cfg')} className="flex items-center gap-1.5 text-xs font-bold text-accent-foreground hover:underline">
              {copied === 'cfg' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied === 'cfg' ? tr('Copied', 'Đã chép') : tr('Copy', 'Chép')}
            </button>
          </div>
          <pre className="mt-1 overflow-x-auto rounded-lg bg-muted px-3 py-2.5 font-mono text-2xs leading-relaxed text-foreground">{config}</pre>
          <p className="mt-1.5 text-2xs text-ink-4">{tr('Replace eno_live_… with an API key from above (it lives in the client config, never sent to the model).', 'Thay eno_live_… bằng một khóa API ở trên (khóa nằm trong cấu hình ứng dụng, không bao giờ gửi tới mô hình).')}</p>
        </div>
      </div>

      <Link href="/developers" className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent-foreground hover:underline">
        <BookOpen className="h-4 w-4" /> {tr('See all tools & docs', 'Xem tất cả công cụ & tài liệu')} →
      </Link>
    </div>
  )
}
