'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/context/language-context'

/** One row of GET /api/connected-apps: one app, all of its live grants on this account. */
type App = { id: string; name: string; scopes: string[]; shop: boolean; connectedAt: string; lastUsedAt: string | null }

/** What each permission lets the app do, in a few words (the consent screen's longer lines say the rest). Literal tr()
 *  calls, so the string harvest (gen-ui-strings) finds them for the machine-translated languages. */
function can(tr: (en: string, vi: string) => string, scope: string): string {
  switch (scope) {
    case 'listings:read': return tr('see your shop', 'xem cửa hàng')
    case 'listings:write': return tr('manage your listings', 'quản lý tin đăng')
    case 'analytics:read': return tr('see your shop’s views and leads', 'xem lượt xem và liên hệ')
    case 'media:write': return tr('upload photos', 'tải ảnh lên')
    case 'messages:read': return tr('read your chats', 'đọc tin nhắn')
    case 'messages:write': return tr('send messages and offers for you', 'gửi tin nhắn và trả giá thay bạn')
    default: return scope
  }
}

/**
 * Settings → Privacy → "Connected apps" (2026-11-17, owner "ok to agents for all"): every app and AI agent this account
 * connected with a sign-in — shop or chat-only — with what it may do and Disconnect, which ends its access at once.
 * The one place ANY account can take back what it allowed; a business keeps Dashboard › Developers for its API keys.
 */
export function ConnectedApps() {
  const { tr, lang } = useLanguage()
  const [list, setList] = useState<App[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const res = await fetch('/api/connected-apps')
      if (!res.ok) throw new Error(String(res.status))
      setList(((await res.json()) as { apps: App[] }).apps)
    } catch {
      setFailed(true)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const disconnect = async (id: string) => {
    setBusy(id); setError('')
    try {
      const res = await fetch(`/api/connected-apps/${id}`, { method: 'DELETE' })
      // 404: already disconnected elsewhere (or it aged out) — the fresh list says so.
      if (!res.ok && res.status !== 404) throw new Error(String(res.status))
      await load()
    } catch {
      setError(tr('Could not disconnect right now — please try again.', 'Chưa ngắt kết nối được — vui lòng thử lại.'))
    } finally {
      setBusy(null)
    }
  }

  if (failed) {
    return (
      <p className="text-sm text-muted-foreground">
        {tr('Could not load your connected apps.', 'Chưa tải được các ứng dụng đã kết nối.')}{' '}
        <Button variant="link" size="none" onClick={() => void load()}>{tr('Try again', 'Thử lại')}</Button>
      </p>
    )
  }
  if (list === null) return <Loader2 className="h-4 w-4 animate-spin text-ink-4" aria-label={tr('Loading', 'Đang tải')} />
  if (list.length === 0) {
    return <p className="text-sm text-muted-foreground">{tr('No apps or AI assistants are connected to your account.', 'Chưa có ứng dụng hay trợ lý AI nào được kết nối với tài khoản của bạn.')}</p>
  }
  const day = (iso: string) => new Date(iso).toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  return (
    <>
      {error && <p role="alert" className="mb-2 text-sm text-destructive">{error}</p>}
      <ul className="divide-y divide-border">
        {list.map((a) => (
          <li key={a.id} className="flex items-start gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">{a.name}</p>
              <p className="text-t-meta text-muted-foreground">
                {tr('Can', 'Được phép')}: {a.scopes.map((s) => can(tr, s)).join(', ')}
              </p>
              <p className="text-t-meta text-muted-foreground">
                {a.lastUsedAt
                  ? tr('Last used {day}', 'Dùng gần nhất {day}').replace('{day}', day(a.lastUsedAt))
                  : tr('Connected {day}', 'Kết nối {day}').replace('{day}', day(a.connectedAt))}
              </p>
            </div>
            <Button variant="outline" size="sm" loading={busy === a.id} onClick={() => void disconnect(a.id)}>
              {tr('Disconnect', 'Ngắt kết nối')}
            </Button>
          </li>
        ))}
      </ul>
    </>
  )
}
