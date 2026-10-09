'use client'

// ── COVER LESSONS AT A GLANCE (2026-10-07) — the card at the top of /teachers/edit (step 1 only, since the
// onboarding redesign of 2026-10-08). ──────────────────────────────────────────────────────────────────────────
// Weekly upkeep must not mean walking five steps: "Still available" re-confirms the saved periods in one tap
// (PATCH /api/teachers/me/cover with the same values), "Change" jumps to the Cover step. For a teacher who has
// not switched cover on yet, the same card is how they hear the feature exists (plan review, 2026-10-07).
// `areas` counts the SAVED reach — derived from the teacher's "Where you teach" places near home since 2026-10-08.
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { CalendarDays, Check } from '@/components/ui/icons'
import { formatCalendarDay } from '@/lib/calendar-day'
import { formatMoneyFull, moneyLocale } from '@/lib/vnd'

export function CoverSummary({ savedOpen, slots, areas, rateVnd, confirmedAt, dirty, status, onConfirm, onEdit, notice = '', hidden = null }: {
  /** whether cover is ON as last SAVED (not as currently edited) */
  savedOpen: boolean
  slots: number
  areas: number
  rateVnd: number | null
  confirmedAt: string | null
  /** The Cover step holds unsaved changes — "Still available" confirms the SAVED values, so say so. */
  dirty: boolean
  status: '' | 'saving' | 'saved' | 'error'
  onConfirm: () => void
  onEdit: () => void
  /** After a stale-window refusal: the form re-read the saved cover (teacher-form reloadSavedCover) and says so here. */
  notice?: string
  /**
   * ⛔ SAVED IS NOT SHOWN (gate review, 2026-10-09): the last save left the profile NOT live (the cover save's `live:
   * false` — a save never re-shows a hidden profile), so the card says so rather than reading as if schools see the
   * availability just confirmed. `onShow` is the way back, "Show my profile to schools" (the Visibility switch's own call
   * — teacher-form changeVisibility); null when the teacher's switch is not what hides it (moderation, an identity
   * hold): said, never offered.
   */
  hidden?: { onShow: (() => void) | null; showing: boolean } | null
}) {
  const { tr, lang } = useLanguage()
  // In BOTH branches: a teacher whose window last saw cover OFF is told too (gate review, 2026-10-07).
  const noticeLine = notice ? <p role="status" className="text-sm text-warning">{notice}</p> : null
  if (!savedOpen) {
    return (
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-tint p-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{tr('New: cover lessons', 'Mới: dạy thay')}</p>
          <p className="text-sm text-body">{tr('Schools look for teachers free for a one-off lesson. Show when you are free and what you charge.', 'Các trường tìm giáo viên rảnh để dạy thay một buổi. Hãy cho biết khi nào bạn rảnh và mức phí của bạn.')}</p>
          {noticeLine}
        </div>
        <Button variant="secondary" size="sm" type="button" onClick={onEdit}><CalendarDays className="size-4" />{tr('Set up cover lessons', 'Thiết lập dạy thay')}</Button>
      </div>
    )
  }
  return (
    <div className="mb-4 space-y-3 rounded-2xl bg-tint p-4">
      <div>
        <p className="text-sm font-semibold text-foreground">{tr('Cover lessons are on', 'Đang nhận dạy thay')}</p>
        <p className="text-sm text-body">
          {slots} {slots === 1 ? tr('free period', 'buổi rảnh') : tr('free periods', 'buổi rảnh')}
          {' · '}{areas} {areas === 1 ? tr('area', 'khu vực') : tr('areas', 'khu vực')}
          {rateVnd != null && <>{' · '}{formatMoneyFull(rateVnd, '₫', moneyLocale(lang))} {tr('/ hour', '/ giờ')}</>}
        </p>
        {confirmedAt && (
          <p className="text-xs text-muted-foreground">{tr('Availability confirmed on', 'Đã xác nhận lịch rảnh ngày')} {formatCalendarDay(confirmedAt, lang)}</p>
        )}
        {noticeLine}
        {dirty && (
          <p className="text-xs text-warning">{tr('You have unsaved changes to your cover lessons — save them with “Save changes”. “Still available” confirms what is saved.', 'Bạn có thay đổi chưa lưu về dạy thay — hãy lưu bằng “Lưu thay đổi”. “Vẫn còn rảnh” chỉ xác nhận lịch đã lưu.')}</p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="cta" size="sm" type="button" onClick={onConfirm} loading={status === 'saving'}>
          <Check className="size-4" />
          {tr('Still available', 'Vẫn còn rảnh')}
        </Button>
        <Button variant="secondary" size="sm" type="button" onClick={onEdit}>{tr('Change', 'Thay đổi')}</Button>
        <span role="status" className="text-sm text-muted-foreground">
          {status === 'saved' ? tr('Saved.', 'Đã lưu.') : status === 'error' ? tr('Could not save. Please try again.', 'Không lưu được. Vui lòng thử lại.') : ''}
        </span>
      </div>
      {hidden && (
        <div className="flex flex-wrap items-center gap-2">
          <p role="status" className="text-sm text-warning">
            {hidden.onShow
              ? tr('Your profile is hidden, so schools can’t see your cover lessons.', 'Hồ sơ của bạn đang bị ẩn, nên các trường không thấy lịch dạy thay của bạn.')
              : tr('Your profile is under review and not visible right now. Contact support if you think this is a mistake.', 'Hồ sơ của bạn đang được xem xét và tạm thời không hiển thị. Liên hệ hỗ trợ nếu bạn cho rằng có nhầm lẫn.')}
          </p>
          {hidden.onShow && (
            <Button variant="secondary" size="sm" type="button" onClick={hidden.onShow} loading={hidden.showing}>{tr('Show my profile to schools', 'Hiển thị hồ sơ cho các trường')}</Button>
          )}
        </div>
      )}
    </div>
  )
}
