'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/ui/avatar'
import { useLanguage } from '@/context/language-context'

type Blocked = { profileId: string; name: string; avatarUrl: string | null; avatarColor: string | null; blockedAt: string }

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

  const unblock = async (profileId: string) => {
    setBusy(profileId); setUnblockError('')
    try {
      const res = await fetch('/api/blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId, blocked: false }),
      })
      if (!res.ok) throw new Error(String(res.status))
      setList((l) => (l ?? []).filter((b) => b.profileId !== profileId))
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
    <ul className="divide-y divide-border">
      {list.map((b) => (
        <li key={b.profileId} className="flex items-center gap-3 py-2.5">
          <Avatar name={b.name} url={b.avatarUrl} color={b.avatarColor} size="sm" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{b.name}</span>
          <Button variant="outline" size="sm" loading={busy === b.profileId} onClick={() => void unblock(b.profileId)}>
            {tr('Unblock', 'Bỏ chặn')}
          </Button>
        </li>
      ))}
    </ul>
    </>
  )
}
