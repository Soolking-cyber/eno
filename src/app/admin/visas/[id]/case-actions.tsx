'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Headset, Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { transitionVisaStatus } from './actions'

// The case's status-transition buttons (the server computes which pairs apply
// from VISA_ADMIN_ACTIONS and passes them down — this component holds no
// workflow knowledge). The action re-validates admin + transition server-side;
// revalidatePath inside it refreshes this server-rendered page on success.
export function VisaCaseActions({ id, actions }: { id: string; actions: Array<[string, string]> }) {
  const [pending, startTransition] = useTransition()
  if (!actions.length) return null
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map(([status, label]) => (
        <Button
          key={status}
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => startTransition(async () => {
            const result = await transitionVisaStatus(id, status)
            if (result.ok) toast.success('Visa case updated')
            else toast.error(`Update failed: ${(result.error || 'unknown error').replaceAll('_', ' ')}`)
          })}
        >
          {label}
        </Button>
      ))}
    </div>
  )
}

/**
 * Who is driving the applicant's chat: the AI wizard, or a human at the desk.
 *
 * ⚠️ A TAKEOVER IS AN EVENT, NOT A STATUS. It writes visa_events
 * `admin_takeover_started` / `admin_takeover_ended`, and the mode is DERIVED from the
 * newest of those (src/lib/visa/dm-thread.ts, getVisaThreadMode) — there is no column, no
 * migration, and nothing here may add one. The case's own status workflow
 * (VISA_ADMIN_TRANSITIONS) is untouched by this control and must stay that way: "an admin
 * is typing in the thread" is not a stage of a government application.
 *
 * While the mode is 'admin' the wizard stops emitting cards, so the desk is not talked
 * over mid-sentence; handing back returns the thread to 'ai' and the applicant's next
 * action resumes the loop where it left off.
 *
 * The route is admin-gated on its own (getAdmin re-verifies with the auth server) — this
 * page's gate proves nothing about the caller of that endpoint.
 */
export function VisaThreadTakeover({ id, mode }: { id: string; mode: 'ai' | 'human_requested' | 'admin' }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const live = mode === 'admin'

  const toggle = async () => {
    if (pending) return
    setPending(true)
    try {
      const res = await fetch(`/api/visa/admin/applications/${id}/takeover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !live }),
      })
      const data = (await res.json().catch(() => null)) as { mode?: string; error?: string } | null
      if (!res.ok) {
        toast.error(`Takeover failed: ${(data?.error || 'unknown error').replaceAll('_', ' ')}`)
        return
      }
      toast.success(data?.mode === 'admin' ? 'You are driving this chat' : 'Handed back to the assistant')
      // The mode is rendered by the server component above — re-read it rather than
      // holding a second copy of the truth on the client.
      router.refresh()
    } catch {
      toast.error('Takeover failed: network error')
    } finally {
      setPending(false)
    }
  }

  return (
    <Button type="button" variant={live ? 'outline' : 'cta'} size="sm" disabled={pending} onClick={toggle}>
      {pending
        ? <Loader2 className="h-4 w-4 animate-spin" />
        : live ? <Sparkles className="h-4 w-4" /> : <Headset className="h-4 w-4" />}
      {live ? 'Hand back to assistant' : 'Take over chat'}
    </Button>
  )
}
