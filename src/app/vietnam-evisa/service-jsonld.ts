import { SITE_NAME } from '@/lib/edition'
import { PROVIDER_OF_RECORD, VISA_PROVIDER } from '@/lib/visa-provider'

/**
 * THE MACHINE-READABLE VERSION OF "WHO ACTUALLY SELLS THIS" — services edition only.
 *
 * The prose on the e-visa pages says the licensed partner performs the visa work under its own
 * licence and that this site is the intermediary. Structured data has to say the same thing, because
 * it is the version a search engine reads and repeats, and because a page whose visible copy
 * disclaims responsibility while its JSON-LD claims the service is the worst of both.
 *
 * ⚠️ `provider` AND `broker` ARE THE TWO PROPERTIES THAT CARRY THE WHOLE ARRANGEMENT.
 * schema.org/Service defines `provider` as the organisation providing the service, and `broker` as
 * "an entity that arranges for an exchange between a buyer and a seller … a broker never acquires or
 * releases ownership of a product or service involved in an exchange". That is exactly the
 * commission arrangement: the partner provides, eno.forum arranges. Emitting only `provider` — or,
 * worse, naming this site as the provider — is the leak this file exists to prevent, and it is the
 * same class of defect as the Organization block that once had eno.forum declaring eno.vn its
 * publisher.
 *
 * ⚠️ NO LICENCE NUMBER, NO TAX CODE, NO ADDRESS, AND THAT IS NOT AN OMISSION TO BE FIXED LATER BY
 * GUESSING. Every one of those fields in src/lib/visa-provider.ts is the placeholder token today.
 * Structured data is a machine-readable ASSERTION: publishing a placeholder as an `identifier` would
 * be publishing a false one, and publishing a plausible-looking real one would be fabricating a
 * licence. When the signed agreement and the verified licence copies are on file, add them here from
 * VISA_PROVIDER and nowhere else.
 *
 * ⚠️ NO `sameAs`, NO `parentOrganization`, NOTHING TYING THE TWO DOMAINS INTO ONE ENTITY. The
 * comment in src/app/layout.tsx explains why that decision was deliberately left to counsel; a
 * `Service` node is not the place to quietly make it. A visible "related site" link is fine. An
 * entity claim in JSON-LD is not.
 *
 * ⚠️ NO `offers`/`price`. Prices live on `Listing.price` and change; a figure baked into ISR HTML
 * goes stale silently, which is the same reasoning that keeps prices out of the e-visa prose (see
 * the note at the head of multiple-entry-cost/page.svc.tsx). The Product JSON-LD on each listing
 * page already carries the real number.
 *
 * ⚠️ THIS MODULE IS NEVER COMPILED ON A MARKETPLACE BUILD, and that is by placement rather than by
 * luck: nothing outside `page.svc.tsx` files imports it, and those do not exist on eno.vn. It also
 * imports `@/lib/visa-provider`, which next.config.ts aliases to an empty stub there — so even a
 * future shared importer would emit an empty name rather than the partner's.
 */
export function visaServiceLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: 'Vietnam e-visa application service',
    serviceType: 'Vietnam e-visa application assistance',
    description: PROVIDER_OF_RECORD.shortEn,
    areaServed: { '@type': 'Country', name: 'Vietnam' },
    // The party that performs the work and answers for it.
    provider: {
      '@type': 'Organization',
      name: VISA_PROVIDER.brand,
      description: 'Licensed Vietnamese travel company holding an international travel-service licence.',
    },
    // The party that lists it and takes a commission — this deployment, naming ITSELF. The url is
    // what makes this node resolve to the same entity as the Organization block in layout.tsx.
    //
    // ⚠️ NO `|| 'https://eno.vn'` FALLBACK HERE, AND THIS IS THE ONE PLACE THAT PATTERN IS WRONG.
    // Every other consumer of NEXT_PUBLIC_APP_URL needs *a* value — metadataBase cannot be
    // undefined, a sitemap cannot emit a relative loc — so falling back to the marketplace apex is
    // the least-bad answer there, and next.config.ts makes it unreachable in a real deployment by
    // refusing to build a declared edition without a matching host. This field needs no value at
    // all: `url` is optional on an Organization, and an ABSENT url costs nothing while a WRONG one
    // publishes "the broker of this visa service is eno.vn" — the licensed company that may not
    // sell it. Caught by the test beside this file in the transitional configuration (no edition
    // set, no APP_URL set), where SITE_NAME already resolves to eno.forum and the fallback did not.
    broker: {
      '@type': 'Organization',
      name: SITE_NAME,
      ...(process.env.NEXT_PUBLIC_APP_URL ? { url: process.env.NEXT_PUBLIC_APP_URL } : {}),
    },
  }
}
