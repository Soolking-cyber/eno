import { redirect } from 'next/navigation'

// There is ONE eno dashboard and it lives on eno.vn (owner 2026-07-18: "same backend,
// use one, delete the other"). This route survives only so old links, the AASA path
// list, and muscle memory keep working — including legacy `?tab=` deep links, which
// must ride along or eno.vn can never resolve them. Same shared account, but the
// ORIGINS have separate cookie jars: a web user signed in only on the forum lands on
// eno.vn signed out and signs in there once (reverse SSO deliberately not built —
// in-app users already hold an eno.vn session, so this only affects the web edge).
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
