import { permanentRedirect } from 'next/navigation'

// Console v2 (2026-09-05): this queue is a tab of a section now. The URL survives as a redirect so
// bookmarks, notification links and the old nav rows keep working; the section is the page.
export const dynamic = 'force-dynamic'

export default async function LegacyAdminRoute({ searchParams }: { searchParams?: Promise<{ q?: string | string[] }> }) {
  // The history search rode on `?q=`; a bookmark of one keeps working.
  const raw = (await searchParams)?.q
  const q = (Array.isArray(raw) ? raw[0] : raw)?.slice(0, 100) // the same cap the search itself applies
  permanentRedirect(`/admin/verification?tab=business${q ? `&q=${encodeURIComponent(q)}` : ''}`)
}
