/**
 * Pin every VietKite listing to the partner's office, and record the address on the storefront.
 *
 *   npx tsx scripts/pin-vietkite-office.ts            # DRY RUN
 *   npx tsx scripts/pin-vietkite-office.ts --apply
 *
 * ⛔ THEY WERE AT (0, 0) — NULL ISLAND, open ocean off Ghana (owner asked for the office address,
 * 2026-08-24; the zeroes were found while checking). `hasRealCoords()` rejects (0,0) precisely so
 * one such row cannot drag the map's fitBounds across the planet, so these fell through to the city
 * table and landed on Ho Chi Minh City centre with a per-id jitter. Right city, wrong place, and
 * `count(lat)` in SQL does NOT reveal it: zero is not null, so the column reads as populated.
 *
 * ⚠️ THE COORDINATE IS INTERPOLATED, AND SAYING SO IS THE POINT. No geocoder returns #276 on Nơ
 * Trang Long. photon.komoot.io knows #54A (10.806953,106.695415), hẻm 104 (10.809056,106.695320),
 * hẻm 290 (10.816624,106.699177) and #440 (10.822445,106.707171), so #276 interpolates to
 * ~10.8160,106.6989 — and reverse-geocoding that point returns "Hẻm 290 Nơ Trang Long, Bình Thạnh",
 * i.e. the right street ~50m from the right number. Good for a map pin, not a survey mark. If an
 * exact fix is ever needed, take it from the partner rather than sharpening the guess here.
 */
import 'dotenv/config'
import { db } from '../src/lib/db'

const APPLY = process.argv.includes('--apply')
const SELLER = 'VietKite'
const OFFICE = {
  address: '276 Nơ Trang Long, Bình Thạnh, Hồ Chí Minh',
  lat: 10.8160,
  lng: 106.6989,
}

async function main() {
  const sellers = await db.seller.findMany({ where: { name: SELLER }, select: { id: true, name: true, location: true } })
  if (sellers.length !== 1) { console.error(`expected exactly one "${SELLER}" storefront, found ${sellers.length}`); process.exit(1) }
  const seller = sellers[0]

  const rows = await db.listing.findMany({
    where: { sellerId: seller.id },
    select: { id: true, title: true, lat: true, lng: true },
  })
  console.log(`${seller.name} (${seller.id}) — ${rows.length} listings, storefront location: ${seller.location ?? '(none)'}`)
  const already = rows.filter((r) => r.lat === OFFICE.lat && r.lng === OFFICE.lng).length
  console.log(`  already pinned: ${already}, to update: ${rows.length - already}`)
  console.log(`  -> ${OFFICE.lat}, ${OFFICE.lng}  (${OFFICE.address})`)

  if (!APPLY) { console.log('\nDRY RUN — re-run with --apply.'); await db.$disconnect(); return }

  const { count } = await db.listing.updateMany({
    where: { sellerId: seller.id },
    data: { lat: OFFICE.lat, lng: OFFICE.lng },
  })
  // The storefront carries the street address; the LISTING's `location` stays "Bình Thạnh", which
  // is what cards show — a full street address on every card is noise, and the pin is the answer
  // to "where is this".
  await db.seller.update({ where: { id: seller.id }, data: { location: OFFICE.address } })
  console.log(`\nAPPLIED: ${count} listings pinned, storefront location set`)
  await db.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
