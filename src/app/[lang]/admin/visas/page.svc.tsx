import { permanentRedirect } from 'next/navigation'

// Console v2 (2026-09-05): this queue is a tab of a section now. The URL survives as a redirect so
// bookmarks, notification links and the old nav rows keep working; the section is the page.
export const dynamic = 'force-dynamic'

export default function LegacyAdminRoute() {
  permanentRedirect('/admin/services?tab=visas')
}
