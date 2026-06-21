import { NextResponse } from 'next/server'
import vnUnits from '@/data/vn-units.json'

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
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  if (searchParams.get('type') === 'wards') {
    const prov = DATA.find((p) => p.code === searchParams.get('province'))
    return NextResponse.json({ wards: prov?.wards ?? [] }, { headers: { 'Cache-Control': CACHE } })
  }
  return NextResponse.json({ provinces: PROVINCES }, { headers: { 'Cache-Control': CACHE } })
}
