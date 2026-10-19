import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * The spec is consumed by codegen and by LLM tool-callers, so its defects are silent: a wrong
 * `servers` URL produces a client that calls the wrong domain, and a missing operationId
 * produces a tool nothing can name. Neither shows up as an error anywhere.
 */
const load = async () => { vi.resetModules(); return import('./route') }
beforeEach(() => { vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn'); vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace') })
afterEach(() => vi.unstubAllEnvs())

describe('the partner API spec', () => {
  it('⛔ GIVES EVERY OPERATION A UNIQUE operationId — function calling needs a name', async () => {
    // An audit on 2026-08-23 found 18 of 18 missing, which made a complete spec unusable for
    // tool calling. These are public symbols: renaming one breaks generated clients we do not
    // control, so the test pins uniqueness AND presence, not a specific list.
    const { SPEC } = await load()
    const ops = Object.values(SPEC.paths).flatMap((p) => Object.values(p as Record<string, { operationId?: string }>))
    expect(ops.length).toBeGreaterThan(0)
    const ids = ops.map((o) => o.operationId).filter(Boolean)
    expect(ids.length, 'every operation needs an operationId').toBe(ops.length)
    expect(new Set(ids).size, 'operationIds must be unique').toBe(ids.length)
  })

  it('⛔ POINTS AT THE DEPLOYMENT SERVING IT, NOT A HARDCODED eno.vn', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://www.eno.forum')
    vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'services')
    const { SPEC } = await load()
    // The bug: /api/v1 compiles into BOTH editions, so eno.forum served a spec titled
    // "eno.vn Partner API" with servers: https://eno.vn/api/v1 — every client generated from
    // it would call the other domain.
    expect(SPEC.servers[0].url).toBe('https://www.eno.forum/api/v1')
    expect(SPEC.servers[0].url).not.toContain('eno.vn')
    expect(SPEC.info.title).not.toContain('eno.vn')
  })

  it('names the marketplace correctly on the marketplace', async () => {
    const { SPEC } = await load()
    expect(SPEC.servers[0].url).toBe('https://eno.vn/api/v1')
    expect(SPEC.info.title).toContain('eno.vn')
  })

  it('⚠️ DECLARES ITS AUTH, so an agent knows it cannot just call these', async () => {
    // Every operation is authenticated. A spec that omits securitySchemes reads as a public
    // API and produces agents that call it and get 401s they cannot explain.
    const { SPEC } = await load()
    expect(Object.keys(SPEC.components.securitySchemes)).toContain('bearerAuth')
    expect(SPEC.security?.length).toBeGreaterThan(0)
  })

  it('every operation documents its responses', async () => {
    const { SPEC } = await load()
    const ops = Object.values(SPEC.paths).flatMap((p) => Object.values(p as Record<string, { responses?: unknown }>))
    expect(ops.every((o) => o.responses), 'an operation with no documented response is unusable for codegen').toBe(true)
  })
})

/**
 * THE LICENCE CHECK ON THE WIRE (owner, 2026-10-14). An e-Visa or Legal & permits listing from any shop but eno's own is
 * created UNPUBLISHED until eno has checked the provider's licence — so the document must stop promising that a 201 is
 * always live, describe `held` on create and edit, name the two attribute keys, and list every new refusal where a
 * client looks for it. Each assertion below is a sentence a partner would otherwise have coded against wrongly.
 */
describe('the partner API spec — e-Visa and Legal & permits wait for eno’s licence check', () => {
  type Obj = Record<string, any>
  const schemas = async () => (await load()).SPEC.components.schemas as unknown as Obj
  const op = async (path: string, method: string) => ((await load()).SPEC.paths as unknown as Obj)[path][method] as Obj

  it('⛔ CreatedListing.verified is a real boolean — no const:true, no "full stop", no "no path returns false" — and `held` is documented', async () => {
    const created = (await schemas()).CreatedListing
    expect(created.properties.verified.type).toBe('boolean')
    expect(created.properties.verified).not.toHaveProperty('const')
    expect(created.properties.held).toMatchObject({ type: 'boolean', const: true })
    expect(created.properties.held.description).toMatch(/licence check/)
    const spec = JSON.stringify((await load()).SPEC)
    expect(spec).not.toMatch(/full stop/)
    expect(spec).not.toMatch(/no path through it that returns false/)
    expect(spec).not.toMatch(/ALWAYS `true`/)
  })

  it('createListing says a 201 may be held, and its 422 lists both provider-licence codes', async () => {
    const create = await op('/listings', 'post')
    expect(create.description).toMatch(/held: true/)
    expect(create.responses['201'].description).toMatch(/held: true/)
    for (const code of ['provider_licence_required', 'provider_licence_invalid']) expect(create.responses['422'].description).toContain(`\`${code}\``)
  })

  it('ListingInput and ListingPatch document both keys; subcategorySlug says a guess counts and a Wanted post never lands there', async () => {
    const s = await schemas()
    for (const schema of [s.ListingInput, s.ListingPatch]) {
      for (const key of ['providerLegalName', 'providerLicenceNo', 'provider_licence_required', 'provider_licence_invalid']) expect(schema.properties.attributes.description).toContain(key)
    }
    expect(s.ListingInput.properties.attributes.description).not.toMatch(/Unknown keys are dropped/)
    expect(s.ListingInput.properties.subcategorySlug.description).toMatch(/inference that lands in services\/visa-legal/)
    expect(s.ListingInput.properties.subcategorySlug.description).toMatch(/"wanted" post never lands/)
    expect(s.ListingPatch.properties.attributes.description).toMatch(/unpublishes the listing until eno has checked them again/)
  })

  it('updateListing answers ListingPatchAck (with `held`), no longer mentions a "republish gate", and lists its new codes', async () => {
    const update = await op('/listings/{id}', 'patch')
    expect(update.responses['200'].content['application/json'].schema).toEqual({ $ref: '#/components/schemas/ListingPatchAck' })
    expect((await schemas()).ListingPatchAck.properties).toMatchObject({ ok: { type: 'boolean', const: true }, held: { type: 'boolean', const: true } })
    expect(update.description).not.toMatch(/republish gate/)
    for (const code of ['provider_licence_required', 'provider_licence_invalid']) expect(update.responses['422'].description).toContain(`\`${code}\``)
    expect(update.responses['409'].description).toContain('`listing_changed`')
  })

  it('setListingStatus and confirmListing document the 409 licence_check_required', async () => {
    for (const [path, method] of [['/listings/{id}/status', 'post'], ['/listings/{id}/confirm', 'post']] as const) {
      expect((await op(path, method)).responses['409'].description, path).toContain('`licence_check_required`')
    }
  })

  it('Listing: `verified` explains the licence wait, and the four verification fields say they are always null', async () => {
    const listing = (await schemas()).Listing.properties
    expect(listing.verified.description).toMatch(/licence check/)
    for (const k of ['verificationMethod', 'verifiedAt', 'verifiedBy', 'verificationNotes']) expect(listing[k].description, k).toBe('Always null (reserved).')
  })

  it('BulkListingInput says a bulk row can never land in a licence aisle', async () => {
    expect((await schemas()).BulkListingInput.description).toMatch(/never lands in e-Visa or Legal & permits/)
  })
})

/**
 * THE JOB-TEXT SCREEN ON THE WIRE (teacher visibility plan §3a item 6, 2026-10-18): a hiring post's text that fails it is
 * refused with one code per rule (job-listing.ts jobTextProblem) — each listed where a partner looks for a create's and an
 * edit's 422s, with the `detail` that names the field and the words; a sync's failed update passes that `detail` on.
 */
describe('the partner API spec — the job-text refusals', () => {
  it('createListing and updateListing list every job-text code among their 422s, and say what `detail` holds', async () => {
    const { JOB_TEXT_BLOCK_CODES } = await import('@/lib/publish-guard')
    const paths = (await load()).SPEC.paths as unknown as Record<string, Record<string, { responses: Record<string, { description: string }> }>>
    for (const [path, method] of [['/listings', 'post'], ['/listings/{id}', 'patch']] as const) {
      const d = paths[path][method].responses['422'].description
      for (const code of JOB_TEXT_BLOCK_CODES) expect(d, `${method} ${path}`).toContain(`\`${code}\``)
      expect(d, `${method} ${path}`).toContain('"<field>:<words>"')
    }
  })

  it('a sync result documents `detail` — a failed update’s pointer', async () => {
    const schemas = (await load()).SPEC.components.schemas as unknown as Record<string, { properties: Record<string, { description: string }> }>
    expect(schemas.SyncRowResult.properties.detail.description).toMatch(/<field>:<words>/)
  })
})
