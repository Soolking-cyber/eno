'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { Button } from '@/components/ui/button'
import type { Background } from '@/lib/classroom/backgrounds'

// The session screen (recorder, voice, and the avatar's lazy SDK behind it) loads only when someone taps to practise.
const SessionScreen = dynamic(() => import('./session/session-screen').then((m) => m.SessionScreen), { ssr: false })

/**
 * The button that opens a practice session — a learner's seat, or `test` for a teacher trying their own avatar. The
 * session itself starts on the screen's Start tap (session-screen.tsx says why).
 */
export function SessionLauncher({ seatId, test, preview, label, variant = 'outline', size = 'sm', className, disabled }: {
  seatId?: string
  test?: boolean
  /** What the screen shows before Start: the avatar's name, the teacher's photo, the room behind the avatar. */
  preview?: { name: string; photoUrl: string | null; background?: Background }
  label: React.ReactNode
  variant?: 'cta' | 'outline'
  size?: 'sm' | 'lg'
  className?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant={variant} size={size} className={className} disabled={disabled} onClick={() => setOpen(true)}>{label}</Button>
      {open && <SessionScreen seatId={seatId} test={test} preview={preview ?? { name: '', photoUrl: null }} onClose={() => setOpen(false)} />}
    </>
  )
}
