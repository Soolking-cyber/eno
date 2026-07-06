'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Search, Bell, BellOff, Trash2 } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
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
            <button
              onClick={() => router.push(s.url)}
              className="flex min-w-0 flex-1 items-center gap-2.5 px-2 text-left cursor-pointer"
            >
              <Search className="h-4 w-4 shrink-0 text-accent-foreground" />
              <span className="truncate text-sm font-medium text-foreground group-hover:underline">{s.label}</span>
            </button>
            <button
              onClick={() => toggle(s)}
              aria-label={s.notify ? tr('Mute alerts', 'Tắt thông báo') : tr('Enable alerts', 'Bật thông báo')}
              title={s.notify ? tr('Alerts on', 'Đang báo') : tr('Alerts off', 'Đã tắt')}
              className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors cursor-pointer hover:bg-accent', s.notify ? 'text-accent-foreground' : 'text-ink-4')}
            >
              {s.notify ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
            </button>
            <button
              onClick={() => remove(s.id)}
              aria-label={tr('Delete saved search', 'Xóa tìm kiếm')}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-4 transition-colors cursor-pointer hover:bg-accent hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}
