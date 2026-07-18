'use client'

import { useEffect, useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { Spinner } from '@/components/ui/spinner'
import { SectionHeader } from '@/components/marketplace/section-header'
import { ItineraryBuilder } from './itinerary-builder'

/** /dashboard/trips/plan — the itinerary PLANNER as a native dashboard sub-page of
 *  the saved-trips section (owner 2026-07-18: no hop to eno.forum — all apps are
 *  combined in the hub). The builder itself is the forum planner ported onto
 *  eno.vn's primitives; research runs through this app's own /api/itineraries/
 *  generate and finished plans land in the same Itinerary tables the section
 *  above already lists. */
export function PlanClient() {
  const { user, loading } = useAuth()
  const { tr } = useLanguage()
  const router = useRouter()
  // Cross-tab account switches must never leave one account's plan on screen for
  // another (the trips-client idiom): refresh in a transition and hide meanwhile.
  const [switching, startSwitch] = useTransition()
  const lastUid = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (user?.id && lastUid.current && user.id !== lastUid.current) startSwitch(() => router.refresh())
    if (user?.id) lastUid.current = user.id
  }, [user?.id, router])

  useEffect(() => {
    if (!loading && !user) router.replace('/signin?next=/dashboard/trips/plan')
  }, [loading, user, router])

  if (loading || switching || !user) {
    return (
      <div role="status" className="flex min-h-[50vh] items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <>
      {/* Native stack-nav title bar (mobile only); Back falls to the parent section. */}
      <SectionHeader title={tr('Itinerary planner', 'Lập lịch trình')} fallbackHref="/dashboard/trips" />
      <ItineraryBuilder />
    </>
  )
}
