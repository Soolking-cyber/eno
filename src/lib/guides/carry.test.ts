import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contentDigest } from '@/lib/teach-guides/digest'
import { applyCarry, digestOf, guideAddress, planCarry, readRegistry, renderRegistry } from '../../../scripts/carry-guides.mjs'

const TODAY = '2026-11-05'
const doc = (slug: string, extra = {}) => ({ slug, title: 'A title', ...extra })
const row = (slug: string, extra: Record<string, unknown> = {}) => {
  const d = (extra.doc as object | undefined) ?? doc(slug)
  return { slug, lang: 'en', status: 'approved', approvedOn: '2026-11-04', digest: digestOf(d), doc: d, ...extra }
}
const SOURCE = "export const GUIDES = [\n  // <generated-guides>\n  // </generated-guides>\n]\n"

describe('carrying approved guides from Reach', () => {
  it('uses the digest eno.vn checks at build time', () => {
    const d = { slug: 'x', title: 'Thuê xe điện', list: [{ b: 1, a: 2 }] }
    expect(digestOf(d)).toBe(contentDigest(d))
  })

  it('dates a new guide today and keeps the day a person approved it', () => {
    const { problems, carry, entries } = planCarry([row('rent-a-bike', { lang: 'vi' })], [], { today: TODAY })
    expect(problems).toEqual([])
    expect(carry.map((r: { slug: string }) => r.slug)).toEqual(['rent-a-bike'])
    expect(entries).toEqual([{ slug: 'rent-a-bike', lang: 'vi', published: TODAY, reviewed: '2026-11-04', reviewedDigest: digestOf(doc('rent-a-bike')) }])
  })

  it('leaves out what has not been approved, and what is already carried', () => {
    const r = row('done')
    const held = [{ slug: 'done', lang: 'en', published: '2026-11-04', reviewed: '2026-11-04', reviewedDigest: r.digest }]
    const { carry, problems, entries } = planCarry([r, { slug: 'a-draft', lang: 'en', status: 'draft' }, { slug: 'an-idea', lang: 'vi', status: 'idea' }], held, { today: TODAY })
    expect(problems).toEqual([])
    expect(carry).toEqual([])
    expect(entries).toEqual(held)
  })

  it('⛔ refuses text that is not what the person approved', () => {
    const { problems } = planCarry([row('edited', { doc: doc('edited', { title: 'Changed since' }), digest: digestOf(doc('edited')) })], [], { today: TODAY })
    expect(problems[0]).toMatch(/not what the person approved/)
    expect(planCarry([row('no-digest', { digest: null })], [], { today: TODAY }).problems[0]).toMatch(/not what the person approved/)
  })

  it('⛔ stops when a carried guide was taken back in Reach, or is unknown to it', () => {
    const held = { slug: 'taken-back', lang: 'en', published: '2026-11-04', reviewed: '2026-11-04', reviewedDigest: 'abc' }
    for (const status of ['rejected', 'idea', 'draft', 'writing', 'failed']) {
      expect(planCarry([{ slug: 'taken-back', lang: 'en', status }], [held], { today: TODAY }).problems[0], status).toMatch(/took it back/)
    }
    expect(planCarry([], [held], { today: TODAY }).problems[0]).toMatch(/not in Reach/)
    // Being rewritten while live is not taken back, but only for the text Reach kept as live: anything else in the registry was carried and then sent back, and would ship at the next deploy.
    for (const status of ['idea', 'writing', 'draft', 'failed']) {
      const rewriting = planCarry([{ slug: 'taken-back', lang: 'en', status, liveDigest: 'abc' }], [held], { today: TODAY })
      expect(rewriting.problems, status).toEqual([])
      expect(rewriting.rewriting, status).toEqual(['taken-back'])
      expect(rewriting.carry, status).toEqual([])
      expect(rewriting.entries, 'the live text stays').toEqual([held])
      expect(planCarry([{ slug: 'taken-back', lang: 'en', status, liveDigest: 'older' }], [held], { today: TODAY }).problems[0], status).toMatch(/took it back/)
    }
    expect(planCarry([{ slug: 'taken-back', lang: 'en', status: 'rejected', liveDigest: 'abc' }], [held], { today: TODAY }).problems[0], 'rejected is always taken back').toMatch(/took it back/)
    const live = row('taken-back', { status: 'published' })
    expect(planCarry([live], [{ ...held, reviewedDigest: live.digest }], { today: TODAY }).problems).toEqual([])
  })

  it('refuses a slug, language, or date eno.vn could not stand behind', () => {
    const one = (r: object) => planCarry([r], [], { today: TODAY }).problems
    expect(one(row('Bad_Slug'))[0]).toMatch(/not an address/)
    expect(one(row('a-guide', { lang: 'fr' }))[0]).toMatch(/no language/)
    expect(one(row('a-guide', { doc: doc('another') , digest: digestOf(doc('another')) }))[0]).toMatch(/says it is "another"/)
    expect(one(row('a-guide', { approvedOn: '2026-11-06' }))[0]).toMatch(/approval date/)
    expect(one(row('a-guide', { approvedOn: null }))[0]).toMatch(/approval date/)
  })

  it('takes a few at a time, oldest approval first, and says what is waiting', () => {
    const rows = ['one', 'two', 'three', 'four'].map((s) => row(s))
    const { carry, waiting, entries } = planCarry(rows, [], { today: TODAY, max: 3 })
    expect(carry.map((r: { slug: string }) => r.slug)).toEqual(['one', 'two', 'three'])
    expect(waiting).toEqual(['four'])
    expect(entries).toHaveLength(3)
  })

  it('⛔ stops on a new guide whose address already has a text in the repo that no registry line owns, rather than write over it', () => {
    const { problems, carry } = planCarry([row('taken-address')], [], { today: TODAY, files: new Set(['taken-address']) })
    expect(problems[0]).toMatch(/src\/content\/guides\/taken-address\.json already exists and no registry line owns it[\s\S]*not live on eno\.vn[\s\S]*killed[\s\S]*delete it[\s\S]*change the Reach article's address/)
    expect(carry).toEqual([])
    const r = row('owned', { doc: doc('owned', { title: 'New words' }), digest: digestOf(doc('owned', { title: 'New words' })) })
    const held = [{ slug: 'owned', lang: 'en', published: '2026-11-04', reviewed: '2026-11-04', reviewedDigest: 'old' }]
    expect(planCarry([r], held, { today: TODAY, files: new Set(['owned']) }).problems, 'its own text, owned by its line: a rewrite').toEqual([])
  })

  it('takes a night of four in one run by default, and still waits past six', () => {
    const rows = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((s) => row(`guide-${s}`))
    const { carry, waiting } = planCarry(rows, [], { today: TODAY })
    expect(carry).toHaveLength(6)
    expect(waiting).toEqual(['guide-g'])
  })

  describe('twins', () => {
    const en = (extra: Record<string, unknown> = {}) => row('rent-a-bike', { pair: 'thue-xe', ...extra })
    const vi = (extra: Record<string, unknown> = {}) => row('thue-xe', { lang: 'vi', pair: 'rent-a-bike', ...extra })

    it('links both lines when both are carried in the same run', () => {
      const { entries, paired } = planCarry([en(), vi()], [], { today: TODAY })
      expect(entries.map((e: { slug: string; pair?: string }) => [e.slug, e.pair])).toEqual([['rent-a-bike', 'thue-xe'], ['thue-xe', 'rent-a-bike']])
      expect(paired).toEqual(['rent-a-bike', 'thue-xe'])
    })

    it('a twin carried alone ships unpaired, and the run that brings the other links both', () => {
      const first = planCarry([en(), vi({ status: 'draft', doc: undefined, digest: null, approvedOn: null })], [], { today: TODAY })
      expect(first.carry.map((r: { slug: string }) => r.slug)).toEqual(['rent-a-bike'])
      expect(first.entries).toEqual([{ slug: 'rent-a-bike', lang: 'en', published: TODAY, reviewed: '2026-11-04', reviewedDigest: digestOf(doc('rent-a-bike')) }])
      expect(first.paired).toEqual([])
      // The next day: the English one is live and Reach calls it published; only the Vietnamese one comes over, and the English line gains its pair and nothing else.
      const later = planCarry([en({ status: 'published' }), vi({ approvedOn: '2026-11-06' })], first.entries, { today: '2026-11-06' })
      expect(later.carry.map((r: { slug: string }) => r.slug)).toEqual(['thue-xe'])
      expect(later.entries).toEqual([
        { ...first.entries[0], pair: 'thue-xe' },
        { slug: 'thue-xe', lang: 'vi', published: '2026-11-06', reviewed: '2026-11-06', reviewedDigest: digestOf(doc('thue-xe')), pair: 'rent-a-bike' },
      ])
      expect(later.paired).toEqual(['rent-a-bike', 'thue-xe'])
      expect(planCarry([en({ status: 'published' }), vi({ status: 'published' })], later.entries, { today: '2026-11-07' }).paired, 'linked once').toEqual([])
    })

    type Line = { slug: string; lang: string; pair?: string }
    const reciprocal = (entries: Line[]) => entries.every((e) => !e.pair || entries.some((t) => t.slug === e.pair && t.pair === e.slug && t.lang !== e.lang))
    const linkedLines = () => planCarry([en(), vi()], [], { today: TODAY }).entries as Line[]
    const live = (r: Record<string, unknown>) => ({ ...r, status: 'published' })
    const omit = (r: Record<string, unknown>) => { const { pair: _gone, ...rest } = r; return rest }

    it('unlinks both lines when Reach stops naming the pair, from either side', () => {
      const lines = linkedLines()
      for (const rows of [[live(en({ pair: null })), live(omit(vi()))], [live(en()), live(vi({ pair: null }))], [live(en({ pair: null })), live(vi())]]) {
        const { entries, paired, problems } = planCarry(rows, lines, { today: TODAY })
        expect(problems).toEqual([])
        expect(entries.map((e: Line) => e.pair)).toEqual([undefined, undefined])
        expect(paired).toEqual(['rent-a-bike', 'thue-xe'])
      }
    })

    it('unlinks both lines when one twin is gone from the export, and the run stops on it anyway', () => {
      const { entries, problems } = planCarry([live(vi())], linkedLines(), { today: TODAY })
      expect(problems[0]).toMatch(/rent-a-bike is in the registry but not in Reach/)
      expect(entries.map((e: Line) => e.pair)).toEqual([undefined, undefined])
    })

    it('⛔ never writes a one-way link, whatever Reach says and whatever the registry held', () => {
      const says = [undefined, null, 'other-guide', 'self']
      // What one side's row says: no word at all, no twin, someone else, or its real twin.
      const as = (v: string | null | undefined, twin: string) => (v === undefined ? {} : { pair: v === 'self' ? twin : v })
      for (const start of [[], linkedLines(), [{ ...linkedLines()[0] }, { ...linkedLines()[1], pair: undefined }]]) {
        for (const a of says) for (const b of says) {
          const rows = [{ ...omit(en()), ...as(a, 'thue-xe') }, { ...omit(vi()), ...as(b, 'rent-a-bike') }].map((r) => (start.length ? live(r) : r))
          const { entries } = planCarry(rows, start as Line[], { today: TODAY })
          expect(reciprocal(entries), JSON.stringify({ a, b, start: start.map((e: Line) => e.pair) })).toBe(true)
        }
      }
    })

    it('stops when Reach has more than one twin for a guide it carries', () => {
      expect(planCarry([en({ twins: 2 }), vi()], [], { today: TODAY }).problems[0]).toMatch(/rent-a-bike has 2 twins in Reach/)
    })

    it('links only twins in two languages that name each other; an export from before twins changes no line', () => {
      const same = planCarry([en(), vi({ lang: 'en' })], [], { today: TODAY })
      expect(same.entries.every((e: { pair?: string }) => !e.pair)).toBe(true)
      const oneWay = planCarry([en(), vi({ pair: 'someone-else' })], [], { today: TODAY })
      expect(oneWay.entries.every((e: { pair?: string }) => !e.pair)).toBe(true)
      const linked = planCarry([en(), vi()], [], { today: TODAY }).entries
      const { pair: _a, ...enOld }: Record<string, unknown> = en({ status: 'published' })
      const { pair: _b, ...viOld }: Record<string, unknown> = vi({ status: 'published' })
      expect(planCarry([enOld, viOld], linked, { today: TODAY })).toMatchObject({ problems: [], carry: [], paired: [], entries: linked })
      // A twin Reach has not written yet is named by a placeholder address that is in no registry.
      expect(planCarry([en({ pair: 'twin-0b6c2a4e-9f1d-4a8e-b3a1-2c5d7e9f0a1b' })], [], { today: TODAY }).entries[0].pair).toBeUndefined()
    })
  })

  it('a rewrite approved again replaces the digest and the review day, and keeps its first date', () => {
    const r = row('rewritten', { doc: doc('rewritten', { title: 'New words' }), digest: digestOf(doc('rewritten', { title: 'New words' })), approvedOn: TODAY })
    const held = [{ slug: 'rewritten', lang: 'en', published: '2026-11-04', reviewed: '2026-11-04', reviewedDigest: 'old' }]
    const { carry, entries } = planCarry([r], held, { today: TODAY })
    expect(carry).toHaveLength(1)
    expect(entries).toEqual([{ slug: 'rewritten', lang: 'en', published: '2026-11-04', released: '2026-11-04', updated: TODAY, reviewed: TODAY, reviewedDigest: r.digest }])
  })

  it('a rewrite Reach already calls published still comes over, because the first text is what answered', () => {
    const r = row('live-then-rewritten', { status: 'published', doc: doc('live-then-rewritten', { title: 'New words' }), digest: digestOf(doc('live-then-rewritten', { title: 'New words' })), approvedOn: TODAY })
    const held = [{ slug: 'live-then-rewritten', lang: 'en', published: '2026-11-01', reviewed: '2026-11-02', reviewedDigest: 'old' }]
    const { carry, entries } = planCarry([r], held, { today: TODAY })
    expect(carry).toHaveLength(1)
    expect(entries[0]).toMatchObject({ released: '2026-11-02', updated: TODAY, reviewedDigest: r.digest })
    expect(planCarry([row('never-carried', { status: 'published' })], [], { today: TODAY }).carry, 'not in the registry: not ours to bring').toEqual([])
  })

  it('⛔ stops when the registry and Reach disagree on the language, since that moves the address', () => {
    const r = row('moved', { lang: 'vi' })
    const { problems, carry } = planCarry([r], [{ slug: 'moved', lang: 'en', published: '2026-11-04', reviewed: '2026-11-04', reviewedDigest: r.digest }], { today: TODAY })
    expect(problems[0]).toMatch(/its address would change/)
    expect(carry).toEqual([])
  })

  it('writes registry lines it can read back, and refuses a line it did not write', () => {
    const entries = [{ slug: 'a', lang: 'en', published: TODAY, reviewed: TODAY, reviewedDigest: 'abc' }, { slug: 'b', lang: 'vi', published: TODAY, reviewed: TODAY, reviewedDigest: 'def', pair: 'a' }]
    const written = renderRegistry(SOURCE, entries)
    expect(written).toContain("  { slug: 'a', lang: 'en', published: '2026-11-05', reviewed: '2026-11-05', reviewedDigest: 'abc' },\n")
    expect(readRegistry(written)).toEqual(entries)
    expect(readRegistry(SOURCE)).toEqual([])
    expect(renderRegistry(written, [])).toBe(SOURCE)
    expect(() => readRegistry(SOURCE.replace('// </generated', "// a hand note\n  // </generated"))).toThrow(/cannot read/)
    expect(() => readRegistry('no markers')).toThrow(/markers/)
    for (const lost of ["{ slug: 'a', lang: \"vi\", published: '2026-11-05' },", "{ slug: 'a', draft: true },", "{ slug: 'a', ...more },"]) {
      expect(() => readRegistry(SOURCE.replace('  // </generated', `  ${lost}\n  // </generated`)), lost).toThrow(/cannot read/)
    }
  })

  describe('writing', () => {
    const setUp = () => {
      const dir = mkdtempSync(join(tmpdir(), 'carry-guides-'))
      const registry = join(dir, 'registry.ts')
      const generated = join(dir, 'generated.ts')
      writeFileSync(registry, SOURCE)
      writeFileSync(generated, 'the index\n')
      writeFileSync(join(dir, 'old.json'), 'the first text\n')
      return { dir, registry, generated, contentDir: dir }
    }
    const plan = planCarry([row('new-one'), row('old', { doc: doc('old', { title: 'Second' }), digest: digestOf(doc('old', { title: 'Second' })) })], [], { today: TODAY })

    it('keeps the files when eno.vn accepts them, in the order the digest was taken', () => {
      const at = setUp()
      applyCarry(plan, { ...at, check: () => {} })
      expect(digestOf(JSON.parse(readFileSync(join(at.dir, 'new-one.json'), 'utf8')))).toBe(digestOf(doc('new-one')))
      expect(readRegistry(readFileSync(at.registry, 'utf8')).map((e: { slug: string }) => e.slug)).toEqual(['new-one', 'old'])
    })

    it('linking twins later writes the registry only: neither guide\'s text, so neither digest, changes', () => {
      const at = setUp()
      const held = [{ slug: 'old', lang: 'en', published: '2026-11-04', reviewed: '2026-11-04', reviewedDigest: digestOf(doc('old')) }, { slug: 'cu', lang: 'vi', published: '2026-11-04', reviewed: '2026-11-04', reviewedDigest: digestOf(doc('cu')) }]
      writeFileSync(at.registry, renderRegistry(SOURCE, held))
      const linking = planCarry([row('old', { status: 'published', pair: 'cu' }), row('cu', { lang: 'vi', status: 'published', pair: 'old' })], held, { today: TODAY })
      expect(linking).toMatchObject({ problems: [], carry: [], paired: ['old', 'cu'] })
      applyCarry(linking, { ...at, check: () => {} })
      expect(readFileSync(join(at.dir, 'old.json'), 'utf8')).toBe('the first text\n')
      expect(readRegistry(readFileSync(at.registry, 'utf8'))).toEqual([{ ...held[0], pair: 'cu' }, { ...held[1], pair: 'old' }])
    })

    it('⛔ puts every file back when eno.vn refuses them, so the next run is not told they are carried', () => {
      const at = setUp()
      expect(() => applyCarry(plan, { ...at, check: () => { writeFileSync(at.generated, 'half done\n'); throw new Error('refused') } })).toThrow('refused')
      expect(existsSync(join(at.dir, 'new-one.json'))).toBe(false)
      expect(readFileSync(join(at.dir, 'old.json'), 'utf8')).toBe('the first text\n')
      expect(readFileSync(at.registry, 'utf8')).toBe(SOURCE)
      expect(readFileSync(at.generated, 'utf8')).toBe('the index\n')
      expect(planCarry(plan.carry, readRegistry(readFileSync(at.registry, 'utf8')), { today: TODAY }).carry, 'still to carry').toHaveLength(2)
    })
  })

  it('points at the address for its language', () => {
    expect(guideAddress({ slug: 'a', lang: 'en' })).toBe('https://eno.vn/guides/a')
    expect(guideAddress({ slug: 'b', lang: 'vi' })).toBe('https://eno.vn/huong-dan/b')
  })
})

describe('carrying a guide\'s pictures (carryPictures)', async () => {
  const { carryPictures, pictureIds } = await import('../../../scripts/carry-guides.mjs')
  const { createHash } = await import('node:crypto')
  const sharp = (await import('sharp')).default
  const png = await sharp({ create: { width: 400, height: 225, channels: 3, background: { r: 200, g: 120, b: 80 } } }).png().toBuffer()
  const id = createHash('sha256').update(png).digest('hex')
  const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://sb.eno.test', SUPABASE_SECRET_KEY: 'k' } as unknown as NodeJS.ProcessEnv
  const webp = await sharp(png).webp().toBuffer()
  const row = (ids: string[], size = { w: 400, h: 225 }) => ({ slug: 'g', doc: { images: { hero: { id: ids[0], ...size }, figures: ids.slice(1).map((x) => ({ id: x, ...size })) } } })
  const storage = (present: Set<string>, calls: { method: string; url: string; headers?: Record<string, string>; body?: Buffer }[]) =>
    (async (url: string, init: { method: string; headers?: Record<string, string>; body?: Buffer }) => {
      calls.push({ url, ...init })
      const here = [...present].some((p) => url.includes(p))
      if (init.method === 'HEAD') return new Response(null, { status: here ? 200 : 404 })
      if (init.method === 'GET') return new Response(new Uint8Array(webp), { status: 200 })
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch

  it('names the hero and the figures', () => expect(pictureIds(row(['a', 'b', 'c']).doc)).toEqual(['a', 'b', 'c']))

  it('a guide without pictures touches nothing', async () => {
    const calls: never[] = []
    expect(await carryPictures([{ slug: 'g', doc: {} }], { fetchImpl: storage(new Set(), calls), env })).toEqual([])
    expect(calls).toHaveLength(0)
  })

  const reach = () => ({ [id]: png.toString('base64') })

  it('a picture already in storage is checked against Reach\'s PNG and never uploaded again', async () => {
    const calls: { method: string; url: string }[] = []
    expect(await carryPictures([row([id])], { fetchImpl: storage(new Set([id]), calls), fromBox: reach, env })).toEqual([])
    expect(calls.map((c) => c.method)).toEqual(['HEAD', 'GET'])
  })

  it('a different picture stored under the id stops the run, even at the right shape', async () => {
    const wrong = await sharp({ create: { width: 400, height: 225, channels: 3, background: { r: 10, g: 200, b: 30 } } }).webp().toBuffer()
    const fake = (async (url: string, init: { method: string }) => (init.method === 'HEAD' ? new Response(null, { status: 200 }) : new Response(new Uint8Array(wrong), { status: 200 }))) as unknown as typeof fetch
    await expect(carryPictures([row([id])], { fetchImpl: fake, fromBox: reach, env })).rejects.toThrow(/not the picture/)
  })

  it('with Reach\'s PNG gone (the guide is live), a stored picture of another shape stops the run', async () => {
    await expect(carryPictures([row([id], { w: 400, h: 400 })], { fetchImpl: storage(new Set([id]), []), fromBox: () => ({}), env })).rejects.toThrow(/not the picture/)
    expect(await carryPictures([row([id])], { fetchImpl: storage(new Set([id]), []), fromBox: () => ({}), env })).toEqual([])
  })

  it('a missing one comes from Reach, is checked against its id, and goes up as WebP without overwrite', async () => {
    const calls: { method: string; url: string; headers?: Record<string, string>; body?: Buffer }[] = []
    expect(await carryPictures([row([id])], { fetchImpl: storage(new Set(), calls), fromBox: reach, env })).toEqual([id])
    const up = calls.find((c) => c.method === 'POST')!
    expect(up.url).toBe(`https://sb.eno.test/storage/v1/object/listings/guides/${id}.webp`)
    expect(up.headers).toMatchObject({ 'content-type': 'image/webp', 'x-upsert': 'false' })
    expect((await sharp(up.body!).metadata()).format).toBe('webp')
  })

  it('stops on bytes that are not the picture approved, on a picture nowhere, without keys, on a wrong size, and on a non-id', async () => {
    const other = Buffer.from(png).fill(1, 100, 120)
    await expect(carryPictures([row([id])], { fetchImpl: storage(new Set(), []), fromBox: () => ({ [id]: other.toString('base64') }), env })).rejects.toThrow(/do not match/)
    await expect(carryPictures([row([id])], { fetchImpl: storage(new Set(), []), fromBox: () => ({}), env })).rejects.toThrow(/neither/)
    await expect(carryPictures([row([id])], { fetchImpl: storage(new Set(), []), fromBox: () => ({}), env: {} as NodeJS.ProcessEnv })).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_URL/)
    await expect(carryPictures([row(['../x'])], { fetchImpl: storage(new Set(), []), env })).rejects.toThrow(/SHA-256/)
    await expect(carryPictures([row([id], { w: 1600, h: 900 })], { fetchImpl: storage(new Set(), []), fromBox: reach, env })).rejects.toThrow(/its guide says/)
  })

  it('Reach unreachable stops the run, even when every picture is already in storage (fail closed)', async () => {
    const down = () => { throw new Error('Command failed: ssh') }
    await expect(carryPictures([row([id])], { fetchImpl: storage(new Set([id]), []), fromBox: down, env })).rejects.toThrow(/could not be read/)
  })

  it('with Reach\'s PNG gone, a stored picture must be exactly the size the upload makes', async () => {
    const tiny = await sharp({ create: { width: 16, height: 9, channels: 3, background: { r: 200, g: 120, b: 80 } } }).webp().toBuffer()
    const fake = (async (url: string, init: { method: string }) => (init.method === 'HEAD' ? new Response(null, { status: 200 }) : new Response(new Uint8Array(tiny), { status: 200 }))) as unknown as typeof fetch
    await expect(carryPictures([row([id])], { fetchImpl: fake, fromBox: () => ({}), env })).rejects.toThrow(/not the picture/)
  })

  it('nothing goes up when any picture of the batch is bad', async () => {
    const other = await sharp({ create: { width: 400, height: 225, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer()
    const otherId = createHash('sha256').update(other).digest('hex')
    const calls: { method: string; url: string }[] = []
    await expect(carryPictures([row([id, otherId])], { fetchImpl: storage(new Set(), calls), fromBox: reach, env })).rejects.toThrow(/neither/)
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0)
  })

  it('a dry run reads and checks everything and uploads nothing', async () => {
    const calls: { method: string; url: string }[] = []
    expect(await carryPictures([row([id])], { dryRun: true, fetchImpl: storage(new Set(), calls), fromBox: reach, env })).toEqual([])
    expect(calls.map((c) => c.method)).toEqual(['HEAD'])
    await expect(carryPictures([row([id])], { dryRun: true, fetchImpl: storage(new Set(), []), fromBox: () => ({}), env })).rejects.toThrow(/neither/)
    await expect(carryPictures([row([id])], { dryRun: true, fetchImpl: storage(new Set(), []), fromBox: reach, env: { NEXT_PUBLIC_SUPABASE_URL: 'https://sb.eno.test' } as unknown as NodeJS.ProcessEnv })).rejects.toThrow(/SUPABASE_SECRET_KEY/)
  })
})
