/**
 * THE TEACH SHARE CARDS ON DISK, TO LOOK AT (src/lib/teach-guides/share-cards.ts) — drawn by the route itself, the GET
 * the build calls, so what you see is what eno.vn serves. Writes nothing but PNGs into <out-dir>; no database, no server.
 *
 *   npx tsx scripts/teach-cards-preview.ts <out-dir>                 # the samples, in every shape
 *   npx tsx scripts/teach-cards-preview.ts <out-dir> <slug|hub> …    # those pages' cards
 *   npx tsx scripts/teach-cards-preview.ts <out-dir> --all           # every card the build renders
 *
 * The samples are the cards the layout was tuned on: the longest and the shortest names (ties included), the hub, and the
 * work-permit and salary guides. Each line printed is a card's file, its title size and lines, and `fits` (share-cards.ts
 * `fitTitle`) — a card that does not fit fails share-cards.test.ts as well.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

async function main() {
  const [outArg, ...rest] = process.argv.slice(2)
  if (!outArg) throw new Error('usage: npx tsx scripts/teach-cards-preview.ts <out-dir> [<slug|hub> … | --all]')
  // The edition is read once, at import: the cards exist on the marketplace only.
  process.env.NEXT_PUBLIC_ENO_EDITION = 'marketplace'
  const { TEACH_GUIDES } = await import('../src/lib/teach-guides/registry')
  const { TEACH_CARD_SHAPES, fitTitle, teachCardParams, teachCardText } = await import('../src/lib/teach-guides/share-cards')
  const { fontMetrics, woff2ToSfnt } = await import('../src/lib/sfnt')
  const { GET } = await import('../src/app/og/teach-in-vietnam/[...card]/route')

  const byLength = [...TEACH_GUIDES].sort((a, b) => a.label.length - b.label.length)
  const ends = byLength.filter((e) => e.label.length === byLength[0].label.length || e.label.length === byLength.at(-1)!.label.length)
  const samples = [...new Set([...ends.map((e) => e.slug), 'hub', 'vietnam-work-permit-for-english-teachers', 'english-teacher-salary-in-vietnam'])]
  const keys = rest.includes('--all') ? null : rest.length ? rest : samples
  const wanted = teachCardParams().filter((p) => keys === null || keys.includes(p.card.length === 1 ? 'hub' : p.card[0]))
  if (!wanted.length) throw new Error(`no such card: ${rest.join(' ')}`)

  const out = resolve(outArg)
  mkdirSync(out, { recursive: true })
  const metrics = fontMetrics(woff2ToSfnt(readFileSync(join(process.cwd(), 'src', 'fonts', 'open-runde-bold.woff2'))))
  for (const { card } of wanted) {
    const key = card.length === 1 ? 'hub' : card[0]
    const shape = TEACH_CARD_SHAPES.find((s) => card.at(-1) === `${s.name}.png`)!
    const res = await GET(new Request(`https://eno.vn/og/teach-in-vietnam/${card.join('/')}`), { params: Promise.resolve({ card }) })
    if (res.status !== 200) throw new Error(`${card.join('/')}: ${res.status}`)
    const file = join(out, `${key}-${shape.name}.png`)
    writeFileSync(file, Buffer.from(await res.arrayBuffer()))
    const fit = fitTitle(teachCardText(key === 'hub' ? null : key)!.title, shape, metrics)
    console.log(`${file}  ${fit.size}px × ${fit.lines.length} line(s)${fit.fits ? '' : '  ⛔ DOES NOT FIT'}  ${JSON.stringify(fit.lines)}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
