/**
 * Give the 17 VinWonders listings REAL map coordinates.
 *
 * ⚠️ WHY THIS EXISTS — MEASURED ON PRODUCTION 2026-08-24, NOT INFERRED. Every listing in the
 * database had real lat/lng EXCEPT these 17. `getListingCoordinates()` falls back to a city table
 * that matches only the literal strings 'hanoi' / 'hà nội' / 'danang' / 'đà nẵng', and our cities
 * are written 'Ha Noi', 'Phu Quoc', 'Nha Trang', 'Hai Phong', 'Nghe An', 'Ha Tinh', 'Hoi An' —
 * none of which match. So all 17 were pinned on Ho Chi Minh City centre with a ±1km hash jitter,
 * directly on top of the 30 visa listings that ARE correctly geocoded there. The map showed a
 * Phu Quoc water park in Saigon, and re-sorting the feed changed which fake pins joined that
 * cluster — which reads as "the visa locations move when I sort".
 *
 * Coordinates come from the partner's OWN Google Maps embed (`addressHyperLink` on
 * booking-tour-api.vinpearl.com/api/bwc/vinwonder/supplierInfo/<code>, which encodes
 * `!3d<lat>!2d<lng>`) for 14 of them; the other three are recorded in the catalogue with their
 * provenance. Read data/vinwonders-destinations.json — `coordsSource` says where each one came
 * from, and no value here was typed from memory.
 *
 * Writes nothing without --apply.
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { db } from '../src/lib/db'

type Dest = { name: string; bookingCode: string; lat: number; lng: number; coordsSource: string }

async function main() {
  const apply = process.argv.includes('--apply')
  const cat = JSON.parse(readFileSync(join(process.cwd(), 'data/vinwonders-destinations.json'), 'utf8'))
  const dests: Dest[] = cat.destinations

  // ⚠️ MATCHED BY TITLE, and only among rows that carry an affiliateUrl. Nothing here may touch a
  // listing that is not one of the partner's — a coordinate written onto a real seller's listing
  // would move their pin to a theme park with no way to notice.
  const rows = await db.listing.findMany({
    where: { affiliateUrl: { not: null } },
    select: { id: true, title: true, lat: true, lng: true },
  })
  console.log(`affiliate listings in the database: ${rows.length}`)

  let planned = 0, skipped = 0
  for (const d of dests) {
    const row = rows.find((r) => r.title === d.name)
    if (!row) { console.log(`  SKIP  ${d.name} — no affiliate listing with this exact title`); skipped++; continue }
    if (!Number.isFinite(d.lat) || !Number.isFinite(d.lng)) { console.log(`  SKIP  ${d.name} — catalogue has no usable coordinate`); skipped++; continue }
    // Vietnam's bounding box. A transposed lat/lng pair (the classic !2d/!3d mix-up) lands
    // outside it, so this catches the one mistake that would otherwise look plausible.
    if (d.lat < 8 || d.lat > 24 || d.lng < 102 || d.lng > 110) {
      console.log(`  SKIP  ${d.name} — ${d.lat},${d.lng} is outside Vietnam; refusing`); skipped++; continue
    }
    console.log(`  SET   ${d.name.padEnd(36)} ${String(d.lat).padEnd(11)} ${String(d.lng).padEnd(12)} (${d.coordsSource})`)
    planned++
    if (apply) await db.listing.update({ where: { id: row.id }, data: { lat: d.lat, lng: d.lng } })
  }

  console.log(`\n${apply ? 'APPLIED' : 'DRY RUN'}: ${planned} to set, ${skipped} skipped`)
  if (apply) {
    const left = await db.listing.count({ where: { affiliateUrl: { not: null }, lat: null } })
    console.log(`affiliate listings still without coordinates: ${left}`)
  }
  await db.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
