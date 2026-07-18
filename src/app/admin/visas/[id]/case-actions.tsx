'use client'

import { useTransition } from 'react'
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
