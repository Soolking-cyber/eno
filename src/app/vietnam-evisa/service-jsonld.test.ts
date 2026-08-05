import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

/**
 * ⚠️ THE ENVIRONMENT IS STUBBED, NOT INHERITED, AND THAT IS THE POINT OF THIS HELPER.
 *
 * `visaServiceLd()` reads `process.env.NEXT_PUBLIC_APP_URL` at CALL time, and this file used to
 * build one `ld` at module scope from whatever the ambient environment happened to hold. That made
 * the suite's answer depend on the machine: measured 2026-08-05, `npm test` was RED locally and
 * GREEN in CI, because this developer's shell exports the repo `.env` (which sets
 * NEXT_PUBLIC_APP_URL=https://eno.vn) while CI's fresh checkout exports nothing. The assertion that
 * fired was the one below at "no entity relationship" — the legal boundary — so the single most
 * important test in this file was passing for an environmental reason rather than a code reason.
 *
 * ⚠️ VITEST WAS NOT THE CAUSE, WHICH IS WORTH RECORDING BECAUSE THE OBVIOUS FIX IS THE WRONG ONE.
 * Vitest does NOT load `.env` — verified by running this suite under `env -i` both with and without
 * a `envDir` override, which changed nothing. Pointing `envDir` at an empty directory therefore
 * fixes nothing; the only durable fix is a test that states its own environment, which is this.
 */
function ldFor(appUrl?: string) {
  // '' rather than a delete: stubEnv treats an empty string as set-but-empty, and the module under
  // test spreads on truthiness (`process.env.NEXT_PUBLIC_APP_URL ? {url} : {}`), so '' reproduces
  // the unset case exactly while remaining trivially restorable.
  vi.stubEnv('NEXT_PUBLIC_APP_URL', appUrl ?? '')
  return visaServiceLd() as Record<string, { name?: string; url?: string } | string>
}

/**
 * The two configurations `next.config.ts:41` actually permits to build. Every test states which one
 * it is asserting, so none of them can pass or fail for a reason that lives outside this file.
 *   · TRANSITIONAL — no edition declared, no host declared. The only shape allowed to build without
 *     a matching host, and the shape the `broker.url` omission exists for.
 *   · SERVICES — the real eno.forum deployment. `next.config.ts` refuses to build the services
 *     edition against any other host, which is why "edition=services with an eno.vn host" is NOT
 *     tested below: it cannot be produced, and a test for an unreachable state would rot.
 */
const SERVICES_HOST = 'https://www.eno.forum'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('e-visa Service JSON-LD', () => {
  it('names the licensed partner as the provider', () => {
    const ld = ldFor()
    const provider = ld.provider as { '@type': string; name: string }
    expect(provider['@type']).toBe('Organization')
    expect(provider.name).toBe(VISA_PROVIDER.brand)
    // Guards against the module being read through the marketplace stub, where brand is ''. An empty
    // provider name would be a Service node with no provider at all — silently the leak this file
    // exists to prevent.
    expect(provider.name).toBeTruthy()
  })

  it('names this deployment as the BROKER, not the provider', () => {
    const ld = ldFor()
    const broker = ld.broker as { '@type': string; name: string; url?: string }
    expect(broker.name).toBe(SITE_NAME)
    // The whole point: the two parties are different, and the site is not the one providing.
    const provider = ld.provider as { name: string }
    expect(broker.name).not.toBe(provider.name)
  })

  it('omits the broker url entirely when no host is configured', () => {
    // ⚠️ THE FIRST DRAFT USED THE REPO'S USUAL `|| 'https://eno.vn'` FALLBACK AND THIS TEST CAUGHT
    // IT. With no NEXT_PUBLIC_APP_URL — the transitional single-deployment configuration —
    // SITE_NAME resolves to eno.forum while the fallback resolved to eno.vn, producing
    // `"broker": {"name":"eno.forum","url":"https://eno.vn"}`: the licensed marketplace published
    // as the broker of a visa service. `url` is optional; absent beats wrong.
    const broker = ldFor().broker as { url?: string }
    expect(broker.url).toBeUndefined()
  })

  it('emits the SERVICES host as the broker url when one is configured', () => {
    // The real eno.forum deployment. Previously this case was never asserted at all — the file
    // built a single `ld` from the ambient environment, so which of the two configurations got
    // tested depended on the machine running it. Both are now stated.
    const broker = ldFor(SERVICES_HOST).broker as { name: string; url?: string }
    expect(broker.url).toBe(SERVICES_HOST)
    expect(broker.name).toBe(SITE_NAME)
  })

  it('publishes no licence number, tax code or address', () => {
    // ⚠️ EVERY ONE OF THOSE FIELDS IS A PLACEHOLDER IN src/lib/visa-provider.ts. Emitting a
    // placeholder as an `identifier` publishes a false one; emitting a plausible-looking real one
    // fabricates a licence. Neither is acceptable, so the node carries none of them — and this test
    // fails if a future edit "completes" the shape from VISA_PROVIDER before the documents exist.
    const serialized = JSON.stringify(ldFor(SERVICES_HOST))
    for (const value of [VISA_PROVIDER.licenceNo, VISA_PROVIDER.taxCode, VISA_PROVIDER.address, VISA_PROVIDER.legalName]) {
      if (!value) continue
      expect(serialized, `${value} is a pending placeholder and must not be published as structured data`).not.toContain(
        value,
      )
    }
    expect(serialized).not.toMatch(/"identifier"|"taxID"|"vatID"|"licence"|"license"/i)
  })

  // ⚠️ RUN AGAINST EVERY CONFIGURATION THAT CAN BUILD, NOT WHICHEVER ONE THE MACHINE SUPPLIES.
  // This is the assertion the whole file exists for, and until 2026-08-05 it was the one most
  // exposed to the ambient environment: it stringifies the WHOLE node, so it sees `broker.url`, and
  // `broker.url` was whatever NEXT_PUBLIC_APP_URL happened to be. On a shell exporting the repo
  // `.env` it read `https://eno.vn` and the test failed; in CI it read nothing and passed. Same
  // commit, opposite results, and the failing one was telling the truth about its own environment.
  it.each([
    ['no host configured (transitional)', undefined],
    ['the services host (eno.forum)', SERVICES_HOST],
  ])('asserts no entity relationship between the two domains — %s', (_label, appUrl) => {
    // ⚠️ THE DECISION IS COUNSEL'S, AND src/app/layout.tsx CARRIES THE REASONING. A `sameAs` or a
    // `parentOrganization` here would quietly make the claim that the Organization block deliberately
    // declines to make — in a file nobody thinks of as the place that claim lives.
    const serialized = JSON.stringify(ldFor(appUrl))
    expect(serialized).not.toMatch(/sameAs|parentOrganization|subOrganization|memberOf/i)
    // And the licensed marketplace must not appear at all — it is neither party to this service.
    expect(serialized).not.toContain('eno.vn')
  })

  it('carries no price, so it cannot go stale', () => {
    // Prices live on Listing.price and change; a figure baked into ISR HTML is wrong silently. The
    // Product JSON-LD on each listing page already carries the real number.
    expect(JSON.stringify(ldFor(SERVICES_HOST))).not.toMatch(/"offers"|"price"|"priceCurrency"/)
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
