'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/ui/avatar'
import { useLanguage } from '@/context/language-context'

/**
 * One row of GET /api/blocks. `handle` is an opaque, blocker-bound HMAC (src/lib/user-blocks.ts) — the
 * list never carries the blocked person's profile id. Null only when the server has no signing secret,
 * in which case that row cannot be unblocked from here.
 */
type Blocked = { handle: string | null; name: string; avatarUrl: string | null; avatarColor: string | null; blockedAt: string }

/**
 * Settings → Privacy → "Blocked users": everyone this account blocked, each with Unblock (App Store
 * Guideline 1.2, plan R3). The caller renders it only while the `ugc-safety` review gate is on; the
 * endpoint answers `enabled: false` otherwise, and this then renders nothing either.
 */
export function BlockedUsers() {
  const { tr } = useLanguage()
  const [list, setList] = useState<Blocked[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [unblockError, setUnblockError] = useState('')

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const res = await fetch('/api/blocks')
      if (!res.ok) throw new Error(String(res.status))
      const data = (await res.json()) as { enabled: boolean; blocked: Blocked[] }
      setList(data.enabled ? data.blocked : [])
    } catch {
      setFailed(true)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const unblock = async (handle: string) => {
    setBusy(handle); setUnblockError('')
    try {
      const res = await fetch('/api/blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle, blocked: false }),
      })
      // 404 = this handle is not (any longer) one of the caller's blocks — undone elsewhere, or minted
      // under a rotated key. Re-read the list rather than pretend, and say so (codex + opus, gate round 1).
      if (res.status === 404) {
        setUnblockError(tr('This list was out of date and has been refreshed — please try again.', 'Danh sách đã cũ và vừa được làm mới — vui lòng thử lại.'))
        // AWAITED, so the row stays busy until the fresh list replaces it — no second tap on a handle
        // already known to be stale (codex, gate round 3).
        await load()
        return
      }
      if (!res.ok) throw new Error(String(res.status))
      setList((l) => (l ?? []).filter((b) => b.handle !== handle))
    } catch {
      setUnblockError(tr('Could not unblock right now — please try again.', 'Chưa bỏ chặn được — vui lòng thử lại.'))
    } finally {
      setBusy(null)
    }
  }

  if (failed) {
    return (
      <p className="text-sm text-muted-foreground">
        {tr('Could not load your blocked users.', 'Chưa tải được danh sách người bị chặn.')}{' '}
        <Button variant="link" size="none" onClick={() => void load()}>{tr('Try again', 'Thử lại')}</Button>
      </p>
    )
  }
  if (list === null) return <Loader2 className="h-4 w-4 animate-spin text-ink-4" aria-label={tr('Loading', 'Đang tải')} />
  if (list.length === 0) {
    return <p className="text-sm text-muted-foreground">{tr('You have not blocked anyone.', 'Bạn chưa chặn ai.')}</p>
  }
  return (
    <>
    {unblockError && <p role="alert" className="mb-2 text-sm text-destructive">{unblockError}</p>}
    {/* A row with no handle: the server has no signing secret, so it cannot verify an unblock. Say so rather
        than show a button that does nothing (codex + opus, gate round 1). */}
    {list.some((b) => !b.handle) && (
      <p className="mb-2 text-sm text-muted-foreground">{tr('Unblocking is unavailable right now. Please try again later.', 'Hiện chưa thể bỏ chặn. Vui lòng thử lại sau.')}</p>
    )}
    <ul className="divide-y divide-border">
      {list.map((b, i) => (
        <li key={b.handle ?? `row-${i}`} className="flex items-center gap-3 py-2.5">
          <Avatar name={b.name} url={b.avatarUrl} color={b.avatarColor} size="sm" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{b.name}</span>
          <Button variant="outline" size="sm" disabled={!b.handle} loading={!!b.handle && busy === b.handle} onClick={() => { if (b.handle) void unblock(b.handle) }}>
            {tr('Unblock', 'Bỏ chặn')}
          </Button>
        </li>
      ))}
    </ul>
    </>
  )
}
