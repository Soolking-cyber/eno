import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * SOURCE-LEVEL guard on the PDP's App Store gate `ios-hide-visa` wiring (D5 = b). The page is ISR with a database
 * behind it, so — like safety-note-and-facts.test.tsx — the file is asserted; the pieces it composes (IosAppHidden,
 * VisaInAppNote, isEVisaProductListing, the CSS hooks) are tested on their own.
 * The rule: the HTML may not vary by user agent (the edge cache shares it), so an e-Visa product's start button or
 * chat sits inside `ios-app-hidden` and the "apply in a web browser" line inside `ios-app-only` — and with the gate
 * off neither wrapper exists.
 */
const PAGE = readFileSync(join(process.cwd(), 'src/app/[lang]/listings/[id]/(pdp)/page.tsx'), 'utf8')

describe('PDP × ios-hide-visa', () => {
  it('decides from the BUILD flag and the listing, never from the request', () => {
    expect(PAGE).toMatch(/const iosHideContact = appReviewGate\('ios-hide-visa'\) && \(isVisaProduct \|\| isEVisaProductListing\(/)
    expect(PAGE).not.toMatch(/headers\(\)/)
  })

  it('hides the desk start button and the partner chat, not the disclosure', () => {
    expect(PAGE).toContain('<IosAppHidden when={iosHideContact}><VisaStart listingId={listing.id} className="mt-4 w-full" /></IosAppHidden>')
    expect(PAGE).toMatch(/<IosAppHidden when=\{iosHideContact\}><ContactComposer\n/)
    // The non-government disclosure is not wrapped.
    expect(PAGE).not.toMatch(/<IosAppHidden[^>]*>\s*<VisaDisclosure/)
  })

  it('says where to apply, only in the iOS app, through the aliased visa module', () => {
    expect(PAGE).toContain('{iosHideContact && <VisaInAppNote kind="apply" className="ios-app-only mt-4" />}')
    expect(PAGE).toMatch(/import \{ VisaInAppNote, VisaPartnerNote, VisaStart, VISA_START_AVAILABLE \} from '@\/components\/marketplace\/visa-start'/)
  })
})
