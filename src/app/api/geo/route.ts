import { NextResponse } from 'next/server'
import vnUnits from '@/data/vn-units.json'
import { route } from '@/lib/api/handler'

export const runtime = 'nodejs'

type Ward = { code: string; name: string; nameEn: string }
type Province = { code: string; name: string; nameEn: string; wards: Ward[] }

const DATA = vnUnits as Province[]
// HCMC first (the live market), then the rest in dataset order.
const PROVINCES = [...DATA]
  .map(({ code, name, nameEn }) => ({ code, name, nameEn }))
  .sort((a, b) => (a.code === '79' ? -1 : b.code === '79' ? 1 : 0))

const CACHE = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800'

// GET /api/geo?type=provinces  → { provinces }
// GET /api/geo?type=wards&province=<code> → { wards }
// Static reference data (Vietnam 2025 administrative units) — cached hard.
//
// ⚠️ WS6 MIGRATION, AND LIKE /api/fx THE WRAPPER IS A NO-OP HERE — uniformity, not a fix.
// `auth: 'public'`: the province/ward pickers run in the post wizard and in guest-visible filters.
// No DB, no fetch, no I/O at all — the data is a module-scope import, so nothing in this handler can
// throw and route()'s error boundary is unreachable. Byte-identical on every branch, including an
// unknown `?province=` (still 200 `{"wards":[]}` with the cache header, via `prov?.wards ?? []`).
//
// Both branches keep returning `NextResponse`s because the shared CACHE header is the entire reason
// this route is cheap; route()'s plain-object path would strip it.
export const GET = route({ auth: 'public' }, async ({ req }) => {
  const { searchParams } = new URL(req.url)
  if (searchParams.get('type') === 'wards') {
    const prov = DATA.find((p) => p.code === searchParams.get('province'))
    return NextResponse.json({ wards: prov?.wards ?? [] }, { headers: { 'Cache-Control': CACHE } })
  }
  return NextResponse.json({ provinces: PROVINCES }, { headers: { 'Cache-Control': CACHE } })
})
