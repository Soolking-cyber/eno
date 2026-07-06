import { PRELAUNCH } from '@/lib/site-legal'

// Always-visible pre-launch notice (both languages at once, deliberately NOT
// dismissible and NOT behind the language toggle): while the MoIT sàn TMĐT
// registration is pending, the site must clearly read as "under construction /
// test operation — not officially operational" to anyone who lands on it.
// Server component, zero JS. Remove by flipping PRELAUNCH in src/lib/site-legal.ts.
export function PrelaunchNotice() {
  if (!PRELAUNCH) return null
  return (
    <div role="status" className="bg-amber-50 px-3 py-1.5 text-center text-[11px] leading-snug text-amber-900 dark:bg-amber-950 dark:text-amber-200">
      <span className="font-semibold">Website đang xây dựng và chạy thử nghiệm — chưa chính thức hoạt động.</span>{' '}
      <span className="opacity-80">This website is under construction and in test operation — not yet officially launched.</span>
    </div>
  )
}
