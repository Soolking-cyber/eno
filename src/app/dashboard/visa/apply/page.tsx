import { redirect } from 'next/navigation'

// /dashboard/visa/apply — there is NOTHING to apply with here any more.
//
// This path first held the ported forum wizard, then became a permanent redirect when the
// assistant moved up to /dashboard/visa (owner 2026-07-18). The wizard itself is gone
// (owner 2026-07-22: "only 1 way should exist through the chat"), so the redirect now
// lands on the CASE LIST — which either opens the applicant's bound thread or offers the
// product picker that starts one. Old bookmarks, notification deep links and
// `signin?next=/dashboard/visa/apply` round-trips therefore still land somewhere real
// instead of a 404, and none of them can reach a form.
export default function VisaApplyRedirect() {
  redirect('/dashboard/visa')
}
