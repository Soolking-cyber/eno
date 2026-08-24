/**
 * Pin every partner's listings to that partner's office, and record the address on the storefront.
 *
 *   npx tsx scripts/pin-partner-offices.ts            # DRY RUN
 *   npx tsx scripts/pin-partner-offices.ts --apply
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
/**
 * ⚠️ EVERY COORDINATE HERE HAS ITS PROVENANCE BESIDE IT, and none was typed from memory. Where a
 * geocoder returns the house number, that is the value. Where it does not, the interpolation and
 * the confirmation are both written down so the next reader can judge it rather than trust it.
 */
const OFFICES: { seller: string; address: string; lat: number; lng: number; source: string }[] = [
  {
    seller: 'VietKite',
    address: '276 Nơ Trang Long, Bình Thạnh, Hồ Chí Minh',
    lat: 10.8160,
    lng: 106.6989,
    // No geocoder returns #276. photon knows #54A, hẻm 104, hẻm 290 and #440 on the same street, so
    // this interpolates between them — and reverse-geocoding the result returns "Hẻm 290 Nơ Trang
    // Long, Bình Thạnh", i.e. the right street ~50m from the right number.
    source: 'interpolated between photon anchors, reverse-geocode confirmed to the street',
  },
  {
    seller: 'CellphoneS',
    // ⚠️ FROM THE MERCHANT'S OWN FOOTER, not from memory: "Địa chỉ văn phòng: 350-352 Võ Văn Kiệt,
    // Phường Cầu Ông Lãnh, Thành phố Hồ Chí Minh". Read off a page fetched before they rate-limited
    // us, which is the only reason it was available to check.
    address: '350-352 Võ Văn Kiệt, Phường Cầu Ông Lãnh, Thành phố Hồ Chí Minh',
    lat: 10.760442,
    lng: 106.694523,
    source: 'photon: Hẻm 354 Võ Văn Kiệt, Cầu Ông Lãnh — the alley beside 350-352, same ward',
  },
  {
    seller: 'GMBR',
    // Taken from the storefront's own `location`, which already held it.
    address: '193/25 Nguyen Dinh Chinh Street - Ward 11 - Phu Nhuan District - Ho Chi Minh City',
    lat: 10.792994,
    lng: 106.673557,
    source: 'photon: 193/3 Nguyễn Đình Chính, Phú Nhuận — the same alley as 193/25',
  },
]

async function main() {
  let pinned = 0
  for (const office of OFFICES) {
    const sellers = await db.seller.findMany({ where: { name: office.seller }, select: { id: true, name: true, location: true } })
    if (sellers.length !== 1) { console.error(`expected exactly one "${office.seller}" storefront, found ${sellers.length} — skipping`); continue }
    const seller = sellers[0]

    const rows = await db.listing.findMany({ where: { sellerId: seller.id }, select: { id: true, lat: true, lng: true } })
    const already = rows.filter((r) => r.lat === office.lat && r.lng === office.lng).length
    const nullIsland = rows.filter((r) => r.lat === 0 && r.lng === 0).length
    console.log(`${seller.name} (${seller.id}) — ${rows.length} listings; ${already} already pinned, ${nullIsland} at (0,0)`)
    console.log(`  -> ${office.lat}, ${office.lng}  [${office.source}]`)

    if (!APPLY) continue
    const { count } = await db.listing.updateMany({ where: { sellerId: seller.id }, data: { lat: office.lat, lng: office.lng } })
    // The storefront carries the street address; the LISTING's `location` stays the district, which
    // is what cards show — a full street address on every card is noise, and the pin answers "where".
    await db.seller.update({ where: { id: seller.id }, data: { location: office.address } })
    pinned += count
  }

  /**
   * SECOND PASS — repair any remaining (0,0) from the seller's OWN cluster.
   *
   * ⛔ (0,0) IS NULL ISLAND, open ocean off Ghana, and it arrives whenever something defaults a
   * missing coordinate to zero. `hasRealCoords()` rejects it so the map falls back to the city
   * table rather than plotting mid-Atlantic — but the row is still wrong, and `count(lat)` in SQL
   * will never show you: zero is not null, so the column reads as fully populated.
   *
   * ⚠️ FROM THE SELLER'S OWN LISTINGS, NOT FROM AN ADDRESS I CHOSE. Three of eno's fifteen e-visa
   * listings were at (0,0) while the other twelve sat together at ~10.77327,106.72620. Copying the
   * modal coordinate of the seller's real rows is a repair; picking a plausible address for someone
   * else's desk would be a guess wearing the same clothes.
   */
  const stranded = await db.listing.findMany({
    where: { status: 'active', lat: 0, lng: 0 },
    select: { id: true, sellerId: true, title: true },
  })
  for (const row of stranded) {
    const siblings = await db.listing.findMany({
      where: { sellerId: row.sellerId, lat: { not: 0 }, NOT: { lat: null } },
      select: { lat: true, lng: true },
    })
    if (!siblings.length) { console.log(`  (0,0) ${row.title.slice(0, 40)} — seller has no located listing to copy; left alone`); continue }
    const tally = new Map<string, { lat: number; lng: number; n: number }>()
    for (const sib of siblings) {
      const key = `${sib.lat},${sib.lng}`
      const hit = tally.get(key)
      if (hit) hit.n++
      else tally.set(key, { lat: sib.lat!, lng: sib.lng!, n: 1 })
    }
    const best = [...tally.values()].sort((a, b) => b.n - a.n)[0]
    console.log(`  (0,0) ${row.title.slice(0, 40)} -> ${best.lat}, ${best.lng} (from ${best.n} sibling listings)`)
    if (APPLY) await db.listing.update({ where: { id: row.id }, data: { lat: best.lat, lng: best.lng } })
  }

  console.log(`\n${APPLY ? `APPLIED: ${pinned} listings pinned, ${stranded.length} rescued from (0,0)` : 'DRY RUN — re-run with --apply.'}`)
  await db.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
