import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SITE_NAME } from '@/lib/edition'
import { VISA_PROVIDER } from '@/lib/visa-provider'
import { visaServiceLd } from './service-jsonld'

/**
 * WHO THE STRUCTURED DATA SAYS SELLS THE VISA SERVICE.
 *
 * ⚠️ THIS IS A LEGAL ASSERTION IN MACHINE-READABLE FORM, WHICH IS WHY IT GETS A TEST AND THE PROSE
 * DOES NOT. A page whose visible copy says "provided by a licensed partner" while its JSON-LD says
 * `"provider": {"name": "eno.forum"}` is worse than one that says nothing: the version a search
 * engine repeats is the wrong one, and it is the version nobody proofreads. The repo has already
 * shipped exactly this defect once, in the other direction — the Organization block had eno.forum
 * declaring eno.vn the publisher of its e-visa pages, found by curling production rather than by
 * any gate.
 *
 * Every assertion below corresponds to a sentence in the arrangement:
 *   · the partner performs the work under its own licence   → `provider`
 *   · eno is the intermediary and takes a commission        → `broker`
 *   · no licence or registration number has been verified   → no identifier fields
 *   · whether the two domains are one entity is for counsel → no sameAs / parentOrganization
 */

const ld = visaServiceLd() as Record<string, { name?: string; url?: string } | string>

describe('e-visa Service JSON-LD', () => {
  it('names the licensed partner as the provider', () => {
    const provider = ld.provider as { '@type': string; name: string }
    expect(provider['@type']).toBe('Organization')
    expect(provider.name).toBe(VISA_PROVIDER.brand)
    // Guards against the module being read through the marketplace stub, where brand is ''. An empty
    // provider name would be a Service node with no provider at all — silently the leak this file
    // exists to prevent.
    expect(provider.name).toBeTruthy()
  })

  it('names this deployment as the BROKER, not the provider', () => {
    const broker = ld.broker as { '@type': string; name: string; url?: string }
    expect(broker.name).toBe(SITE_NAME)
    // The whole point: the two parties are different, and the site is not the one providing.
    const provider = ld.provider as { name: string }
    expect(broker.name).not.toBe(provider.name)
  })

  it('emits a broker url only when the environment supplies one', () => {
    // ⚠️ THE FIRST DRAFT USED THE REPO'S USUAL `|| 'https://eno.vn'` FALLBACK AND THIS TEST CAUGHT
    // IT. With no NEXT_PUBLIC_APP_URL — the transitional single-deployment configuration, and the
    // configuration a test run has — SITE_NAME resolves to eno.forum while the fallback resolved to
    // eno.vn, producing `"broker": {"name":"eno.forum","url":"https://eno.vn"}`: the licensed
    // marketplace published as the broker of a visa service. `url` is optional; absent beats wrong.
    const broker = ld.broker as { url?: string }
    expect(broker.url).toBe(process.env.NEXT_PUBLIC_APP_URL || undefined)
  })

  it('publishes no licence number, tax code or address', () => {
    // ⚠️ EVERY ONE OF THOSE FIELDS IS A PLACEHOLDER IN src/lib/visa-provider.ts. Emitting a
    // placeholder as an `identifier` publishes a false one; emitting a plausible-looking real one
    // fabricates a licence. Neither is acceptable, so the node carries none of them — and this test
    // fails if a future edit "completes" the shape from VISA_PROVIDER before the documents exist.
    const serialized = JSON.stringify(ld)
    for (const value of [VISA_PROVIDER.licenceNo, VISA_PROVIDER.taxCode, VISA_PROVIDER.address, VISA_PROVIDER.legalName]) {
      if (!value) continue
      expect(serialized, `${value} is a pending placeholder and must not be published as structured data`).not.toContain(
        value,
      )
    }
    expect(serialized).not.toMatch(/"identifier"|"taxID"|"vatID"|"licence"|"license"/i)
  })

  it('asserts no entity relationship between the two domains', () => {
    // ⚠️ THE DECISION IS COUNSEL'S, AND src/app/layout.tsx CARRIES THE REASONING. A `sameAs` or a
    // `parentOrganization` here would quietly make the claim that the Organization block deliberately
    // declines to make — in a file nobody thinks of as the place that claim lives.
    const serialized = JSON.stringify(ld)
    expect(serialized).not.toMatch(/sameAs|parentOrganization|subOrganization|memberOf/i)
    // And the licensed marketplace must not appear at all — it is neither party to this service.
    expect(serialized).not.toContain('eno.vn')
  })

  it('carries no price, so it cannot go stale', () => {
    // Prices live on Listing.price and change; a figure baked into ISR HTML is wrong silently. The
    // Product JSON-LD on each listing page already carries the real number.
    expect(JSON.stringify(ld)).not.toMatch(/"offers"|"price"|"priceCurrency"/)
  })

  it('is emitted by every services page that offers the service', () => {
    // ⚠️ A NODE NOBODY RENDERS IS A NODE THAT PROVES NOTHING. These three pages are where the
    // service is offered — the hub, the official-process guide, and the services landing page — and
    // each must pass it through to its renderer. A new e-visa page that forgets is the gap.
    for (const file of [
      'src/app/vietnam-evisa/page.svc.tsx',
      'src/app/vietnam-evisa/official-process/page.svc.tsx',
      'src/app/services-for-expats-vietnam/page.svc.tsx',
    ]) {
      expect(readFileSync(file, 'utf8'), `${file} does not emit the provider/broker Service node`).toMatch(
        /jsonLd:\s*\[visaServiceLd\(\)\]/,
      )
    }
  })
})
