// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * "Suggest a school" end to end against a REAL Postgres (2026-10-05): /api/schools/suggest and the moderator's
 * add / already-listed / reject actions, with the importer's validation and the alias rule. Only the session,
 * the rate limiter and the ISR purge are stubbed.
 *
 * ⛔ Same opt-in and guards as schools-routes.probe.test.ts: RACE_DB_TESTS=1, loopback only, never :5433.
 * Run it: DATABASE_URL=postgresql://postgres@127.0.0.1:5544/eno RACE_DB_TESTS=1 npx vitest run src/app/api/schools/schools-suggest.probe.test.ts
 */
const url = process.env.DATABASE_URL || ''
const parsed = (() => { try { return new URL(url) } catch { return null } })()
const loopback = ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(parsed?.hostname ?? '')
const live = process.env.RACE_DB_TESTS === '1' && loopback && parsed?.port !== '5433'

const h = vi.hoisted(() => ({ me: null as null | Record<string, unknown>, admin: null as string | null, purged: [] as string[] }))
vi.mock('@/lib/admin', () => ({
  getCurrentProfile: async () => h.me,
  getCurrentProfileId: async () => (h.me?.id as string | undefined) ?? null,
  getAdmin: async () => h.admin,
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))
vi.mock('@/lib/revalidate-lang', () => ({ revalidatePublicPath: (p: string) => { h.purged.push(p) } }))

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const S1 = uuid(9301), S2 = uuid(9302), BAD = uuid(9303)
const LISTED = 'probe-suggest-listed', HIDDEN = 'probe-suggest-hidden'
/** Names this probe suggests — the schools and aliases it may create are found (and removed) by these. */
const NEW_NAME = 'Probe Suggest Brightway Academy', OTHER_NAME = 'Probe Suggest Lotus Centre'

describe.skipIf(!live)('/api/schools/suggest against a real Postgres', () => {
  let db: typeof import('@/lib/db').db
  let NextRequest: typeof import('next/server').NextRequest
  const call = async (mod: Record<string, unknown>, method: string, body?: unknown) => {
    const handler = mod[method] as (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>
    const req = new NextRequest('https://eno.vn/api/x', { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    const res = await handler(req, { params: Promise.resolve({}) })
    return { status: res.status, json: await res.json().catch(() => null) as Record<string, any> | null }
  }
  let suggest: Record<string, unknown>, admin: Record<string, unknown>
  const as = async (id: string | null) => { h.me = id ? await db.profile.findUnique({ where: { id } }) : null }

  async function reset() {
    const slugs = [LISTED, HIDDEN, 'probe-suggest-brightway-academy', 'probe-suggest-lotus-centre']
    await db.school.deleteMany({ where: { OR: [{ slug: { in: slugs } }, { slug: { startsWith: 'probe-suggest-brightway-academy-' } }] } })
    await db.profile.deleteMany({ where: { id: { in: [S1, S2, BAD] } } })
  }

  beforeAll(async () => {
    db = (await import('@/lib/db')).db
    NextRequest = (await import('next/server')).NextRequest
    suggest = await import('./suggest/route')
    admin = await import('../admin/schools/route')
    await reset()
    for (const id of [S1, S2, BAD]) await db.profile.create({ data: { id, email: `${id.slice(-4)}@probe.test`, displayName: 'Probe', accountType: 'individual' } })
    await db.profile.update({ where: { id: BAD }, data: { enforcementState: 'suspended' } })
    for (const [slug, status, website] of [[LISTED, 'active', 'https://www.probe-listed.edu.vn'], [HIDDEN, 'hidden', null]] as const) {
      const s = await db.school.create({ data: { slug, name: slug, kind: 'language_centre', status, website } })
      await db.schoolAlias.create({ data: { alias: slug.replace(/-/g, ' '), schoolId: s.id } })
    }
  })
  afterAll(async () => { await reset(); await db.$disconnect() })

  it('signed out 401; a restricted account 403; contact details and generic names refused', async () => {
    await as(null)
    expect((await call(suggest, 'POST', { name: NEW_NAME, kind: 'language_centre' })).status).toBe(401)
    await as(BAD)
    expect(await call(suggest, 'POST', { name: NEW_NAME, kind: 'language_centre' })).toMatchObject({ status: 403, json: { error: 'account_restricted' } })
    await as(S1)
    expect(await call(suggest, 'POST', { name: NEW_NAME, kind: 'language_centre', note: 'call 0903 123 456' })).toMatchObject({ status: 400, json: { error: 'contact_in_text' } })
    expect(await call(suggest, 'POST', { name: 'English Centre', kind: 'language_centre' })).toMatchObject({ status: 400, json: { error: 'school_name_invalid' } })
    expect(await call(suggest, 'POST', { name: NEW_NAME, kind: 'language_centre', district: 'Hanoi' })).toMatchObject({ status: 400, json: { error: 'district_invalid' } })
  })

  it('a listed school is answered with its page; a hidden one never is; the same website asks first', async () => {
    await as(S1)
    expect(await call(suggest, 'POST', { name: 'Probe Suggest Listed', kind: 'language_centre' })).toMatchObject({ status: 200, json: { listed: { slug: LISTED } } })
    // Hidden: stored for the moderator, never named to the public.
    const hid = await call(suggest, 'POST', { name: 'Probe Suggest Hidden', kind: 'language_centre' })
    expect(hid).toMatchObject({ status: 200, json: { suggestion: { status: 'pending', school: null } } })
    expect(JSON.stringify(hid.json)).not.toContain(HIDDEN)
    expect(await call(suggest, 'POST', { name: OTHER_NAME, kind: 'language_centre', website: 'probe-listed.edu.vn/about' })).toMatchObject({ status: 200, json: { possible: { slug: LISTED } } })
    expect(await call(suggest, 'POST', { name: OTHER_NAME, kind: 'language_centre', website: 'probe-listed.edu.vn/about', confirmNew: true })).toMatchObject({ status: 200, json: { suggestion: { status: 'pending' } } })
  })

  it('one pending suggestion per name, and at most 3 waiting per account', async () => {
    await as(S1)
    expect((await call(suggest, 'POST', { name: NEW_NAME, kind: 'language_centre', district: 'District 7' })).status).toBe(200)
    expect(await call(suggest, 'POST', { name: NEW_NAME, kind: 'language_centre' })).toMatchObject({ status: 409, json: { error: 'already_submitted' } })
    // S1 now has three waiting (hidden, other, new): a fourth is refused.
    expect(await call(suggest, 'POST', { name: 'Probe Suggest Fourth Place', kind: 'agency' })).toMatchObject({ status: 429, json: { error: 'too_many_suggestions' } })
    // Another teacher may suggest the same school; the moderator's add answers both.
    await as(S2)
    expect((await call(suggest, 'POST', { name: NEW_NAME, kind: 'language_centre' })).status).toBe(200)
  })

  it('a moderator adds it as a school (aliases included); every waiting suggestion of that name is answered', async () => {
    const mine = await db.schoolSuggestion.findFirstOrThrow({ where: { profileId: S1, nameKey: 'probe suggest brightway academy' } })
    await as(S1)
    expect((await call(admin, 'POST', { action: 'suggestion_add', suggestionId: mine.id, name: NEW_NAME, kind: 'language_centre', website: null, districts: ['District 7'] })).status).toBe(403) // signed in, not an admin
    h.admin = 'probe-admin@eno.vn'
    // The moderator corrects the name; the other teacher's suggestion (as first written) is answered all the same.
    const added = await call(admin, 'POST', { action: 'suggestion_add', suggestionId: mine.id, name: `${NEW_NAME} HCMC`, kind: 'language_centre', website: null, districts: ['District 7'] })
    expect(added).toMatchObject({ status: 200, json: { slug: 'probe-suggest-brightway-academy-hcmc' } })
    const school = await db.school.findUniqueOrThrow({ where: { slug: 'probe-suggest-brightway-academy-hcmc' }, include: { aliases: true } })
    expect(school).toMatchObject({ name: `${NEW_NAME} HCMC`, status: 'active', districts: ['District 7'] })
    expect(school.aliases.map((a) => a.alias)).toContain('probe suggest brightway academy hcmc')
    expect(h.purged).toContain('/schools')
    for (const id of [S1, S2]) {
      expect(await db.schoolSuggestion.findFirstOrThrow({ where: { profileId: id, nameKey: 'probe suggest brightway academy' } })).toMatchObject({ status: 'added', schoolId: school.id })
    }
    // Decided once: a second add is refused, and nothing is created twice.
    expect(await call(admin, 'POST', { action: 'suggestion_add', suggestionId: mine.id, name: NEW_NAME, kind: 'language_centre', districts: [] })).toMatchObject({ status: 409, json: { error: 'already_resolved' } })
    // The suggester sees the school.
    h.admin = null
    await as(S1)
    const list = await call(suggest, 'GET')
    expect(list.json?.suggestions.find((x: { name: string }) => x.name === NEW_NAME)).toMatchObject({ status: 'added', school: { slug: 'probe-suggest-brightway-academy-hcmc' } })
  })

  it('an alias another school answers to is never moved: the moderator marks it already listed instead', async () => {
    const hid = await db.schoolSuggestion.findFirstOrThrow({ where: { profileId: S1, nameKey: 'probe suggest hidden' } })
    h.admin = 'probe-admin@eno.vn'
    expect(await call(admin, 'POST', { action: 'suggestion_add', suggestionId: hid.id, name: 'Probe Suggest Hidden', kind: 'language_centre', districts: [] })).toMatchObject({ status: 409, json: { error: 'alias_taken' } })
    expect((await db.schoolSuggestion.findUniqueOrThrow({ where: { id: hid.id } })).status).toBe('pending') // rolled back
    expect((await call(admin, 'POST', { action: 'suggestion_duplicate', suggestionId: hid.id, schoolSlug: HIDDEN })).status).toBe(200)
    // The suggester is told it is done, but never which hidden school it matched.
    h.admin = null
    await as(S1)
    const list = await call(suggest, 'GET')
    expect(list.json?.suggestions.find((x: { name: string }) => x.name === 'Probe Suggest Hidden')).toMatchObject({ status: 'duplicate', school: null })
  })

  it('a rejection carries its reason to the suggester', async () => {
    const other = await db.schoolSuggestion.findFirstOrThrow({ where: { profileId: S1, nameKey: 'probe suggest lotus centre' } })
    h.admin = 'probe-admin@eno.vn'
    expect((await call(admin, 'POST', { action: 'suggestion_reject', suggestionId: other.id, reason: 'Not in Ho Chi Minh City' })).status).toBe(200)
    expect(await call(admin, 'POST', { action: 'suggestion_reject', suggestionId: other.id, reason: 'again' })).toMatchObject({ status: 409, json: { error: 'already_resolved' } })
    h.admin = null
    await as(S1)
    const list = await call(suggest, 'GET')
    expect(list.json?.suggestions.find((x: { name: string }) => x.name === OTHER_NAME)).toMatchObject({ status: 'rejected', rejectReason: 'Not in Ho Chi Minh City' })
  })
})
