'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Search, Bell, BellOff, Trash2 } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Tooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

type SavedSearch = { id: string; label: string; notify: boolean; createdAt: string; url: string }

// Buyer's saved searches on the /saved page: run, toggle alerts, or delete. Hidden
// entirely when signed out or empty (favorites remain the page's primary content).
export function SavedSearches() {
  const router = useRouter()
  const { tr } = useLanguage()
  const { user, loading } = useAuth()
  const [searches, setSearches] = useState<SavedSearch[] | null>(null)

  useEffect(() => {
    // Guests have no saved searches — skip the call entirely (an unauthenticated
    // fetch here logged a 401 in every guest's console).
    if (loading) return
    if (!user) { setSearches([]); return }
    let off = false
    fetch('/api/saved-searches')
      .then((r) => (r.ok ? r.json() : { searches: [] }))
      .then((d) => { if (!off) setSearches(d.searches || []) })
      .catch(() => { if (!off) setSearches([]) })
    return () => { off = true }
  }, [user, loading])

  // Optimistic updates WITH rollback — a silently-failed toggle/delete would
  // otherwise leave the UI lying about what's saved.
  const failed = () => toast.error(tr("Couldn't save that — try again", 'Chưa lưu được — thử lại'))
  const toggle = async (s: SavedSearch) => {
    setSearches((prev) => prev?.map((x) => (x.id === s.id ? { ...x, notify: !s.notify } : x)) ?? prev)
    try {
      const res = await fetch(`/api/saved-searches/${s.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notify: !s.notify }) })
      if (!res.ok) throw new Error()
    } catch {
      setSearches((prev) => prev?.map((x) => (x.id === s.id ? { ...x, notify: s.notify } : x)) ?? prev)
      failed()
    }
  }
  const remove = async (id: string) => {
    const snapshot = searches
    setSearches((prev) => prev?.filter((x) => x.id !== id) ?? prev)
    try {
      const res = await fetch(`/api/saved-searches/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
    } catch {
      setSearches(snapshot)
      failed()
    }
  }

  if (!searches || searches.length === 0) return null

  return (
    <section className="mb-10 space-y-2">
      <h2 className="h-section text-foreground">{tr('Saved searches', 'Tìm kiếm đã lưu')}</h2>
      <p className="text-xs text-muted-foreground">{tr("We'll alert you when a new listing matches.", 'Sẽ báo cho bạn khi có tin mới phù hợp.')}</p>
      <div className="mt-2 divide-y divide-transparent">
        {searches.map((s) => (
          <div key={s.id} className="group flex items-center gap-2 rounded-xl py-2 pr-1 transition-colors hover:bg-muted">
            <Button
              variant="bare"
              size="none"
              onClick={() => router.push(s.url)}
              className="flex min-w-0 flex-1 shrink items-center justify-start gap-2.5 px-2 text-left cursor-pointer"
            >
              <Search className="h-4 w-4 shrink-0 text-accent-foreground" />
              <span className="truncate text-sm font-medium text-foreground group-hover:underline">{s.label}</span>
            </Button>
            <Tooltip content={s.notify ? tr('Alerts on', 'Đang báo') : tr('Alerts off', 'Đã tắt')} side="top">
              <IconButton
                size="sm"
                tapTarget={false}
                onClick={() => toggle(s)}
                aria-label={s.notify ? tr('Mute alerts', 'Tắt thông báo') : tr('Enable alerts', 'Bật thông báo')}
                className={cn('transition-colors hover:bg-accent', s.notify ? 'text-accent-foreground' : 'text-ink-4')}
              >
                {/* §5 icon-language: alerts-ON is USER-state ("something is yours/waiting" —
                    the same family as the unread bell in the header), so it takes the solid
                    fill-brand + text-brand stroke; OFF stays a quiet ink line. The toggle then
                    reads at a glance instead of hinging on the tiny slash. */}
                {s.notify ? <Bell className="h-4 w-4 fill-brand text-brand" /> : <BellOff className="h-4 w-4" />}
              </IconButton>
            </Tooltip>
            <IconButton
              size="sm"
              tapTarget={false}
              onClick={() => remove(s.id)}
              aria-label={tr('Delete saved search', 'Xóa tìm kiếm')}
              className="text-ink-4 transition-colors hover:bg-accent hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </IconButton>
          </div>
        ))}
      </div>
    </section>
  )
}
