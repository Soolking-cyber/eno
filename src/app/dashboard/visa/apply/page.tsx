import { redirect } from 'next/navigation'

// The assistant used to live at its own /dashboard/visa/apply sub-page; it now IS the
// /dashboard/visa section (owner 2026-07-18). Keep this path as a permanent redirect
// so old bookmarks, notification deep links, and signin?next= round-trips still land.
export default function VisaApplyRedirect() {
  redirect('/dashboard/visa')
}
