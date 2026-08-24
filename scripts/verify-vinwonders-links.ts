/**
 * Re-resolve every VinWonders affiliate link and compare the destination against the bookingCode
 * recorded in data/vinwonders-destinations.json.
 *
 *   npx tsx scripts/verify-vinwonders-links.ts
 *
 * ⛔ WHY THIS IS SEPARATE FROM THE SEED. A short link is a mutable redirect owned by someone else:
 * re-issuing one in the affiliate dashboard can silently repoint it at a different attraction, and
 * the label ("Ocean City HN") is not enough to notice — that label already turned out to mean
 * Aquafield Ocean City (AQF02), not Grand World. Comparing the resolved `code=` catches a swap that
 * no amount of reading the JSON would. It stays out of the seed because the seed must not depend on
 * 17 third-party network calls to publish.
 */
import { readFileSync } from 'node:fs'

type Dest = { slug: string; name: string; affiliateUrl: string | null; bookingCode: string | null }
const data = JSON.parse(readFileSync(new URL('../data/vinwonders-destinations.json', import.meta.url), 'utf8'))

async function resolveCode(shortUrl: string): Promise<string | null> {
  const res = await fetch(shortUrl, { redirect: 'manual' })
  const loc = res.headers.get('location')
  if (!loc) return null
  const wrapped = new URL(loc).searchParams.get('url')
  if (!wrapped) return null
  return new URL(wrapped).searchParams.get('code')
}

async function main() {
  let bad = 0
  for (const d of data.destinations as Dest[]) {
    if (!d.affiliateUrl) { console.log(`  skip  ${d.slug.padEnd(30)} no link`); continue }
    let actual: string | null = null
    try { actual = await resolveCode(d.affiliateUrl) } catch (e) {
      console.log(`  ERR   ${d.slug.padEnd(30)} ${(e as Error).message.slice(0, 60)}`); bad++; continue
    }
    if (actual === d.bookingCode) console.log(`  ok    ${d.slug.padEnd(30)} ${actual}`)
    else { console.log(`  DRIFT ${d.slug.padEnd(30)} expected ${d.bookingCode}, got ${actual}`); bad++ }
  }
  if (bad) { console.error(`\n${bad} link(s) do not match their recorded code — do not publish until resolved.`); process.exit(1) }
  console.log('\nAll links resolve to their recorded booking code.')

}

main().catch((e) => { console.error(e); process.exit(1) })
