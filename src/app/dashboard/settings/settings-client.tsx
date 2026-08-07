'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Cookie } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { useDashboard } from '@/hooks/use-dashboard'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { ProfileEditor } from '@/components/marketplace/profile-editor'
import { BusinessProfileEditor } from '@/components/marketplace/business-profile-editor'
import { BusinessVerificationPanel } from '@/components/marketplace/business-verification-panel'
import { HandleSettings } from '@/components/marketplace/handle-settings'
import { ChangeEmailForm } from '@/components/marketplace/change-email-form'
import { AccountTypeSwitcher } from '@/components/marketplace/account-type-switcher'
import { ReminderSettings } from '@/components/marketplace/reminder-settings'
import { DeleteAccount } from '@/components/marketplace/delete-account'
import { SectionHeader } from '@/components/marketplace/section-header'

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
    // Content-shaped first paint (matches the other dashboard sections, f359299b): the stack title
    // bar + grouped-card skeletons, not a centered spinner.
    return (
      <div role="status" aria-label={tr('Loading…', 'Đang tải…')}>
        <SectionHeader title={tr('Settings', 'Cài đặt')} />
        <div className="w-full">
          {/* h1: text-xl font-bold, sr-only below lg (28px line box) */}
          <Skeleton className="h-7 w-28 rounded-lg max-lg:hidden" />
          {/* ⚠️ FLAT GROUPS, NOT CARDS. The real body is a stack of <SettingsGroup>s —
              `mt-6 border-t pt-6` + an uppercase text-xs caption + `mt-3` content, with NO box
              around anything ("No space-y: each SettingsGroup carries its own hairline"). The
              four `h-28 rounded-2xl` cards this used to draw promised exactly the boxed
              treatment the flat canon removed, and account-client.tsx's own comment warns
              against it. */}
          <div className="mt-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className={cn(i > 0 && 'mt-6 border-t border-border pt-6')}>
                <Skeleton className="h-4 w-24" />
                <div className="mt-3 space-y-2">
                  <Skeleton className="h-4 w-40 max-w-full" />
                  <Skeleton className="h-11 w-full max-w-md rounded-xl" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // Tier alone decides business vs individual (matching the account panel). `dash.seller`
  // is checked ONLY when choosing the editor — a business whose seller row is briefly missing
  // must still get the business account-type control, not be misidentified as individual.
  const isBusiness = dash?.tier === 'business'

  return (
    // FULL WIDTH (owner, 2026-07-24) — the 2xl reading column left most of the dashboard
    // shell empty beside it while the two-up form fields stayed cramped. The shell already
    // supplies the canonical page width and gutter, so `w-full` is exactly "full width".
    // SectionHeader still sits OUTSIDE this column: its gutter bleed (-mx-3/sm:-mx-6) must be
    // measured from the layout's full-width main.
    <>
      {/* Native stack-nav title bar (mobile only) — same established title string. */}
      <SectionHeader title={tr('Settings', 'Cài đặt')} />
      <div className="w-full">
        {/* h1 stays for the outline; the SectionHeader carries the visible mobile title. */}
        <h1 className="text-xl font-bold text-foreground max-lg:sr-only">{tr('Settings', 'Cài đặt')}</h1>

      {!dash ? (
        // Second stage (auth resolved, `dash` still in flight) — the SAME flat-group shape as
        // the gate above, so the two skeletons agree instead of swapping a 16+10+10 stack for
        // four cards.
        <div className="mt-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={cn(i > 0 && 'mt-6 border-t border-border pt-6')}>
              <Skeleton className="h-4 w-24" />
              <div className="mt-3 space-y-2">
                <Skeleton className="h-4 w-40 max-w-full" />
                <Skeleton className="h-11 w-full max-w-md rounded-xl" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div
          // No space-y: each SettingsGroup carries its own hairline + rhythm now.
          className="mt-6"
        >
          <SettingsGroup first caption={isBusiness ? tr('Business profile', 'Hồ sơ doanh nghiệp') : tr('Your profile', 'Hồ sơ của bạn')}>
            {isBusiness && dash.seller
              ? <BusinessProfileEditor seller={dash.seller} repName={dash.profile.displayName} onSaved={refresh} />
              : <ProfileEditor profile={dash.profile} onSaved={refresh} />}
          </SettingsGroup>
          {/* Its OWN inset card (mt-6 rounded-2xl border bg-card) — must NOT be wrapped in a
              SettingsGroup or it double-borders. Renders as a sibling group in the space-y-6 flow. */}
          {isBusiness && dash.seller && <BusinessVerificationPanel />}
          <SettingsGroup caption={tr('Handle', 'Tên định danh')}><HandleSettings /></SettingsGroup>
          <SettingsGroup caption={tr('Email', 'Email')}><ChangeEmailForm currentEmail={dash.profile.email} /></SettingsGroup>
          <SettingsGroup caption={tr('Account type', 'Loại tài khoản')}><AccountTypeSwitcher isBusiness={isBusiness} businessName={dash.profile.businessName} onSaved={refresh} /></SettingsGroup>
          <SettingsGroup caption={tr('Reminders', 'Nhắc nhở')}><ReminderSettings /></SettingsGroup>
          {/* Consent withdrawal (PDPL): the footer's "Cookie settings" link is the other entry
              point, but the footer is hidden in the native app — this row must exist so withdrawing
              consent stays as easy as giving it, on every platform. */}
          <SettingsGroup caption={tr('Privacy', 'Quyền riêng tư')}>
            <Button
              variant="ghost"
              size="none"
              onClick={() => window.dispatchEvent(new CustomEvent('eno:open-consent'))}
              className="px-4 py-2 font-semibold text-body hover:bg-muted hover:text-body"
            >
              <Cookie className="h-4 w-4" /> {tr('Cookie settings', 'Cài đặt cookie')}
            </Button>
          </SettingsGroup>
          <SettingsGroup caption={tr('Danger zone', 'Vùng nguy hiểm')} danger><DeleteAccount /></SettingsGroup>
        </div>
      )}
      </div>
    </>
  )
}

// A settings block on the FLAT canvas: a small muted caption, a hairline separating it from the
// block above, and the content — no card around it (canon §3b, owner 2026-07-24).
//
// ⚠️ Only the CONTAINER changed. This was an iOS "inset grouped" card until the flat-surface
// directive; the structure, ordering and skeleton parity from that work are untouched and still
// carry the native feel. Both external reviewers read the directive the same way: it supersedes
// the box, not the layout inside it.
function SettingsGroup({ caption, danger, first, children }: { caption: string; danger?: boolean; first?: boolean; children: React.ReactNode }) {
  return (
    <section className={cn(!first && 'mt-6 border-t border-border pt-6')}>
      <h2 className={cn('text-xs font-semibold uppercase tracking-wide', danger ? 'text-destructive' : 'text-ink-4')}>{caption}</h2>
      <div className="mt-3">{children}</div>
    </section>
  )
}
