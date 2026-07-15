'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { useDashboard } from '@/hooks/use-dashboard'
import { Spinner } from '@/components/ui/spinner'
import { Skeleton } from '@/components/ui/skeleton'
import { ProfileEditor } from '@/components/marketplace/profile-editor'
import { BusinessProfileEditor } from '@/components/marketplace/business-profile-editor'
import { HandleSettings } from '@/components/marketplace/handle-settings'
import { ChangeEmailForm } from '@/components/marketplace/change-email-form'
import { AccountTypeSwitcher } from '@/components/marketplace/account-type-switcher'
import { ReminderSettings } from '@/components/marketplace/reminder-settings'
import { DeleteAccount } from '@/components/marketplace/delete-account'
import { PreferencesInline } from '@/components/marketplace/preferences-inline'

/** /dashboard/settings — the full account settings, one section per area (identical set
 *  to what the account panel used to drill into: profile, handle, email, account type,
 *  reminders, device prefs, danger zone). Renders as a page in <main>; the nav rail links
 *  here. Reads the shared dashboard cache. */
export function SettingsClient() {
  const { user, loading } = useAuth()
  const { tr } = useLanguage()
  const router = useRouter()
  const { dash, refresh } = useDashboard()

  useEffect(() => {
    if (!loading && !user) router.replace('/signin?next=/dashboard/settings')
  }, [loading, user, router])

  if (loading || !user) {
    return (
      <div role="status" className="flex justify-center py-20">
        <Spinner size="lg" />
      </div>
    )
  }

  // Tier alone decides business vs individual (matching the account panel). `dash.seller`
  // is checked ONLY when choosing the editor — a business whose seller row is briefly missing
  // must still get the business account-type control, not be misidentified as individual.
  const isBusiness = dash?.tier === 'business'

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-bold text-foreground">{tr('Settings', 'Cài đặt')}</h1>

      {!dash ? (
        <div className="mt-6 space-y-3">
          <Skeleton className="h-16 rounded-2xl" />
          <Skeleton className="h-10 rounded-xl" />
          <Skeleton className="h-10 rounded-xl" />
        </div>
      ) : (
        <div className="mt-6 space-y-8">
          <section>
            <h2 className="text-sm font-bold text-foreground">{isBusiness ? tr('Business profile', 'Hồ sơ doanh nghiệp') : tr('Your profile', 'Hồ sơ của bạn')}</h2>
            <div className="mt-3">
              {isBusiness && dash.seller
                ? <BusinessProfileEditor seller={dash.seller} repName={dash.profile.displayName} onSaved={refresh} />
                : <ProfileEditor profile={dash.profile} onSaved={refresh} />}
            </div>
          </section>

          <section>
            <h2 className="text-sm font-bold text-foreground">{tr('Handle', 'Tên định danh')}</h2>
            <div className="mt-3"><HandleSettings /></div>
          </section>

          <section>
            <h2 className="text-sm font-bold text-foreground">{tr('Email', 'Email')}</h2>
            <div className="mt-3"><ChangeEmailForm currentEmail={dash.profile.email} /></div>
          </section>

          <section>
            <h2 className="text-sm font-bold text-foreground">{tr('Account type', 'Loại tài khoản')}</h2>
            <div className="mt-3"><AccountTypeSwitcher isBusiness={isBusiness} businessName={dash.profile.businessName} onSaved={refresh} /></div>
          </section>

          <section>
            <h2 className="text-sm font-bold text-foreground">{tr('Reminders', 'Nhắc nhở')}</h2>
            <div className="mt-3"><ReminderSettings /></div>
          </section>

          <section>
            <h2 className="text-sm font-bold text-foreground">{tr('Device preferences', 'Tùy chọn thiết bị')}</h2>
            <div className="mt-3"><PreferencesInline /></div>
          </section>

          <section>
            <h2 className="text-sm font-bold text-destructive">{tr('Danger zone', 'Vùng nguy hiểm')}</h2>
            <div className="mt-3"><DeleteAccount /></div>
          </section>
        </div>
      )}
    </div>
  )
}
