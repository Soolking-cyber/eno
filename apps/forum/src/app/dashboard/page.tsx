import { redirect } from 'next/navigation'

// There is ONE eno dashboard and it lives on eno.vn. No current forum UI links here:
// every account entry uses the canonical URL directly. This redirect is retained only
// for old bookmarks and previously issued deep links.
const MARKETPLACE_URL = process.env.NEXT_PUBLIC_MARKETPLACE_URL || 'https://eno.vn'

export default async function DashboardRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === 'string') qs.set(k, v)
  }
  const query = qs.toString()
  redirect(`${MARKETPLACE_URL}/dashboard${query ? `?${query}` : ''}`)
}
