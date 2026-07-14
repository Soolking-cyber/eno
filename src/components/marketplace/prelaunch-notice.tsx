/* eslint-disable react/jsx-no-literals -- deliberately bilingual (VI+EN shown simultaneously per ND52 test-operation notice) */
import { PRELAUNCH } from '@/lib/site-legal'

// Always-visible pre-launch notice (both languages at once, deliberately NOT
// dismissible and NOT behind the language toggle): while the MoIT sàn TMĐT
// registration is pending, the site must clearly read as "under construction /
// test operation — not officially operational" to anyone who lands on it.
// Server component, zero JS. Remove by flipping PRELAUNCH in src/lib/site-legal.ts.
export function PrelaunchNotice() {
  if (!PRELAUNCH) return null
  return (
    <div id="prelaunch-banner" role="status" className="bg-warning/10 px-3 py-1.5 text-center text-2xs leading-snug text-warning">
      <span className="font-semibold">Website đang xây dựng và chạy thử nghiệm — chưa chính thức hoạt động.</span>{' '}
      {/* No opacity-80 here: the old amber-900 was dark enough to survive it, but
          --warning at 80% lands at 3.95:1 on its own tint and fails WCAG AA (axe caught
          it on every page — this banner is site-wide). The Vietnamese half already
          carries the emphasis via font-semibold, so the hierarchy survives. */}
      <span>This website is under construction and in test operation — not yet officially launched.</span>
    </div>
  )
}
