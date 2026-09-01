'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { DashboardTabs, DashboardTabPanelSkeleton, type DashboardTab } from '@/components/marketplace/dashboard-tabs'
import { useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { useDashboard } from '@/hooks/use-dashboard'
import { Button } from '@/components/ui/button'
import { LogOut } from '@/components/ui/icons'
import { PreferencesInline } from '@/components/marketplace/preferences-inline'
import { SettingsClient } from './settings-client'
import { DevClient } from '../dev/dev-client'

/**
 * SETTINGS — combines the former /dashboard/settings, /dashboard/dev and the mobile display-prefs
 * into one tabbed section (owner, 2026-09-01). It mounts the existing clients CONTENT-ONLY rather
 * than re-slicing the sensitive settings component: Settings stays whole (its own captioned groups
 * give the fine structure), Preferences carries the display prefs + sign-out (so a desktop user gets
 * language/currency/theme too, not only the mobile account hub), Developers is the API surface.
 *
 * ⚠️ THIS IS *NOT* /dashboard/account. That route is the mobile NAVIGATION HUB (all dashboard
 * sections + trust + live badges) and must stay whole — an earlier draft wrongly merged this here
 * and deleted the hub, stranding mobile users. Settings is reached from the hub's / rail's identity
 * card (account-panel-body.tsx, account-client.tsx), which is why it needs no nav row of its own.
 */
function PreferencesTab() {
  const { tr } = useLanguage()
  const { signOut, user, loading } = useAuth()
  const router = useRouter()
  // ⚠️ SELF-GATE like every sibling tab client. Settings' other panels (SettingsClient, DevClient)
  // redirect a signed-out viewer, but Preferences is a new component that would otherwise render its
  // display controls + Sign out to a guest deep-linking `?tab=preferences` — the one Settings tab
  // with no auth handling of its own. Send a signed-out viewer to sign-in, same as the others.
  useEffect(() => {
    if (!loading && !user) router.replace('/signin?next=/dashboard/settings')
  }, [loading, user, router])
  if (!loading && !user) return null
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-4">{tr('Display', 'Hiển thị')}</h2>
        <PreferencesInline className="pt-1" />
      </section>
      {/* Quiet sign-out (canon §6): the least-used destructive action stays the quietest control. */}
      <div className="border-t border-border pt-6">
        <Button variant="outline" size="sm" onClick={() => void signOut()} className="w-full justify-center">
          <LogOut className="h-4 w-4" />
          {tr('Sign out', 'Đăng xuất')}
        </Button>
      </div>
    </div>
  )
}

export function SettingsTabs() {
  const { tr } = useLanguage()
  const { dash, loading } = useDashboard()
  const requested = useSearchParams().get('tab')

  // ⚠️ DEVELOPERS IS BUSINESS-TIER ONLY — the same gate the nav rail applied as `role: 'business'`.
  // DevClient bounces a non-business viewer to /dashboard/listings on mount, so surfacing the tab to
  // everyone would eject an individual out of Settings the instant they tapped it. Show it only once
  // the dashboard payload confirms the business tier; a non-business deep link falls back to Settings,
  // never a bounce.
  const tabs: DashboardTab[] = [
    { value: 'settings', label: tr('Settings', 'Cài đặt'), content: <SettingsClient embedded /> },
    { value: 'preferences', label: tr('Preferences', 'Tuỳ chọn'), content: <PreferencesTab /> },
  ]
  // `confirmedIndividual` is the ONLY state that hides a requested Developers tab: the payload came
  // back and the viewer is not business. Loading and a FAILED payload both leave it un-confirmed.
  const confirmedIndividual = !loading && !!dash && dash.tier !== 'business'
  if (dash?.tier === 'business') {
    tabs.push({ value: 'developers', label: tr('Developers', 'Lập trình'), content: <DevClient embedded /> })
  } else if (requested === 'developers' && !confirmedIndividual) {
    // Deep-link / redirect to ?tab=developers before the tier is confirmed. While LOADING, show a
    // skeleton — mounting no client avoids both the Settings-fallback flash AND an eject if the
    // viewer turns out individual. If the dashboard payload FAILED (no tier at all), mount the real
    // DevClient so the business feature stays REACHABLE and shows its own state, rather than the tab
    // silently vanishing (which would hide bulk/dev from a business seller during a dashboard outage).
    tabs.push({ value: 'developers', label: tr('Developers', 'Lập trình'), content: loading ? <DashboardTabPanelSkeleton /> : <DevClient embedded /> })
  }

  return (
    <DashboardTabs title={tr('Settings', 'Cài đặt')} fallbackHref="/dashboard/account" tabs={tabs} />
  )
}
